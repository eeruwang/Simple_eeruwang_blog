// api/[[...all]].ts
import { handleNewPost } from "../lib/api/newpost.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";
export const config = { runtime: "nodejs" };

import { put } from "@vercel/blob";
import { renderIndex } from "../routes/public/index.js";
import { renderPost } from "../routes/public/post.js";
import { renderPage } from "../routes/public/page.js";
import { renderTag } from "../routes/public/tag.js";
import { renderRSS } from "../routes/public/rss.js";
import { renderEditorHTML } from "../lib/pages/editor.js";
import { handleEditorApi } from "../lib/api/editor.js";
import { pingDb } from "../lib/db/db.js";
import { createDb, bootstrapDb } from "../lib/api/editor.js";

/* Env 타입(간소화) */
type Env = {
  EDITOR_PASSWORD?: string;
  SITE_URL?: string;
  [k: string]: unknown;
};

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

/* ── 토큰 도우미 ── */
function getEditorTokenFromHeaders(req: VercelRequest): string {
  return (
    ((req.headers["x-editor-token"] as string) ||
      (req.headers["x-editor-key"] as string) ||
      "") as string
  ).trim();
}

function getEditorToken(req: VercelRequest, url: URL): string {
  return getEditorTokenFromHeaders(req) || (url.searchParams.get("token") || "").trim();
}

/* ── 공개 GET 화이트리스트 ──
   - GET /api/posts            (목록, ?slug= 또는 ?id= 포함)
   - GET /api/posts/:id        (단건)
   - GET /api/diag-db          (헬스체크)
*/
function isPublicApiGet(req: VercelRequest, url: URL): boolean {
  if (req.method !== "GET") return false;
  const p = url.pathname;
  if (p === "/api/posts") return true;
  if (/^\/api\/posts\/\d+$/.test(p)) return true;
  if (p === "/api/diag-db") return true;
  if (p === "/api/nocodb-diag") return true;
  return false;
}

/* ── 보안 헤더 & CORS 유틸 ── */
function setSecurityHeadersVercel(res: VercelResponse) {
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function originOf(u?: string | string[]): string | null {
  const s = Array.isArray(u) ? u[0] : u;
  if (!s) return null;
  try {
    return new URL(s).origin;
  } catch {
    return null;
  }
}
function allowedOrigin(env: Env, host?: string | string[], protoHint = "https"): string | null {
  const site = (env.SITE_URL || "").replace(/\/+$/, "");
  if (site) {
    try {
      return new URL(site).origin;
    } catch {
      /* ignore */
    }
  }
  const h = Array.isArray(host) ? host[0] : host;
  return h ? `${protoHint}://${h}` : null;
}
function applyEditorCors(req: VercelRequest, res: VercelResponse, env: Env) {
  const reqOrigin = originOf(req.headers.origin as any);
  const allow = allowedOrigin(env, req.headers.host, (req.headers["x-forwarded-proto"] as string) || "https");
  if (reqOrigin && allow && reqOrigin === allow) {
    res.setHeader("Access-Control-Allow-Origin", reqOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Editor-Token, X-Editor-Key");
  res.setHeader("Access-Control-Max-Age", "600");
}

/* WHATWG Response → Vercel res 브리지 */
async function sendFetchResponse(res: VercelResponse, r: globalThis.Response) {
  res.status(r.status);
  r.headers.forEach((v, k) => res.setHeader(k, v));
  setSecurityHeadersVercel(res); // 보안 헤더 보강
  const buf = Buffer.from(await r.arrayBuffer());
  res.send(buf);
}

/* HTML이면 cache-control: no-store 강제 */
async function withNoStore(resp: globalThis.Response): Promise<globalThis.Response> {
  const ct = resp.headers.get("content-type") || "";
  if (!/text\/html/i.test(ct)) return resp;
  const h = new Headers(resp.headers);
  if (!h.has("cache-control")) h.set("cache-control", "no-store");
  const buf = await resp.arrayBuffer();
  return new Response(buf, { status: resp.status, headers: h });
}

/* HTML 응답에 /assets/site.js를 자동 주입 */
async function withSiteJs(resp: globalThis.Response): Promise<globalThis.Response> {
  const ct = resp.headers.get("content-type") || "";
  if (!/text\/html/i.test(ct)) return resp;

  const html = await resp.text();
  if (/\/assets\/site\.js/i.test(html)) {
    const h = new Headers(resp.headers);
    return new Response(html, { status: resp.status, headers: h });
    }
  const inject = `<script src="/assets/site.js" defer></script>`;
  const patched = html.includes("</body>")
    ? html.replace("</body>", `${inject}\n</body>`)
    : `${html}\n${inject}\n`;

  const headers = new Headers(resp.headers);
  if (!headers.get("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }
  return new Response(patched, { status: resp.status, headers });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const env = process.env as unknown as Env;
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const url = new URL(req.url!, `${proto}://${req.headers.host}`);
  const rawPath = (req.query.path as string | undefined) ?? "";
  const path = rawPath ? `/${rawPath.replace(/^\/+/, "")}` : url.pathname;

  try {
    // 0) 헬스체크 (공개)
    if (path === "/api/diag-db" && req.method === "GET") {
      try {
        const r = await pingDb();
        setSecurityHeadersVercel(res);
        return res.status(200).json({ ok: true, ...r });
      } catch (e: any) {
        setSecurityHeadersVercel(res);
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    }

    // NocoDB 경로 진단 (공개) — 어떤 API 경로가 동작하는지 테스트
    if (path === "/api/nocodb-diag" && req.method === "GET") {
      try {
        const { nocoDiag } = await import("../lib/db/nocodb.js");
        const result = await nocoDiag();
        setSecurityHeadersVercel(res);
        return res.status(200).json(result);
      } catch (e: any) {
        setSecurityHeadersVercel(res);
        return res.status(500).json({ error: String(e?.message || e) });
      }
    }

    // ── Admin: DB 부트스트랩 (posts 테이블/트리거 생성)
    if (path === "/api/admin/bootstrap" && (req.method === "POST" || req.method === "GET")) {
      const tok = getEditorToken(req, url);
      if (!tok || tok !== env.EDITOR_PASSWORD) {
        setSecurityHeadersVercel(res);
        return res.status(401).json({ error: "Unauthorized" });
      }
      try {
        const db = await createDb(env as any);
        await bootstrapDb(db);
        setSecurityHeadersVercel(res);
        return res.status(200).json({ ok: true });
      } catch (e: any) {
        setSecurityHeadersVercel(res);
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    }

    // ── Admin: 샘플 포스트 생성
    if (path === "/api/admin/newpost" && (req.method === "POST" || req.method === "GET")) {
      const tok = getEditorToken(req, url);
      if (!tok || tok !== env.EDITOR_PASSWORD) {
        setSecurityHeadersVercel(res);
        return res.status(401).json({ error: "Unauthorized" });
      }
      try {
        const db = await createDb(env as any);
        const { rows: ins } = await db.query(
          `insert into posts (title, slug, body_md, tags, excerpt, is_page, published)
           values ($1,$2,$3,$4,$5,$6,$7)
           returning id, slug`,
          [
            "Hello World",
            `hello-${Date.now()}`,
            "# Hello\n\n샘플 글입니다.",
            ["test", "sample"],
            "샘플 글",
            false,
            true,
          ]
        );
        setSecurityHeadersVercel(res);
        return res.status(200).json({ ok: true, id: ins[0]?.id, slug: ins[0]?.slug });
      } catch (e: any) {
        setSecurityHeadersVercel(res);
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    }

    // 1) 에디터 키 체크
    if (path === "/api/check-key" && req.method === "GET") {
      const tok = getEditorTokenFromHeaders(req);
      const ok = !!tok && tok === env.EDITOR_PASSWORD;
      setSecurityHeadersVercel(res);
      return res.status(ok ? 200 : 401).json({ ok });
    }

    // (프리플라이트)
    if (path.startsWith("/api/") && req.method === "OPTIONS") {
      applyEditorCors(req, res, env);
      setSecurityHeadersVercel(res);
      return res.status(204).end();
    }

    // 2) DB 진단 (보호됨)
    if (path === "/api/diag" && req.method === "GET") {
      const tok = getEditorTokenFromHeaders(req);
      if (!tok || tok !== env.EDITOR_PASSWORD) {
        applyEditorCors(req, res, env);
        setSecurityHeadersVercel(res);
        return res.status(401).json({ error: "Unauthorized" });
      }
      try {
        const info = await pingDb();
        setSecurityHeadersVercel(res);
        return res.status(200).json({ ok: true, db: info });
      } catch (e: any) {
        setSecurityHeadersVercel(res);
        return res.status(500).json({ ok: false, error: String(e) });
      }
    }

    // 2.8) 새 글/부트스트랩 (/api/newpost) - GET 또는 POST (보호됨: 토큰은 내부 handleNewPost에서 검사)
    if (path === "/api/newpost" && (req.method === "GET" || req.method === "POST")) {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) headers.set(k, v.join(", "));
        else if (typeof v === "string") headers.set(k, v);
      }
      let bodyInit: BodyInit | undefined;
      if (req.method === "POST") {
        if (Buffer.isBuffer(req.body)) bodyInit = new Uint8Array(req.body);
        else if (typeof req.body === "string") bodyInit = req.body;
        else if (req.body != null) {
          if (!headers.has("content-type")) headers.set("content-type", "application/json");
          bodyInit = JSON.stringify(req.body);
        }
      }
      const webReq = new Request(url.toString(), { method: req.method, headers, body: bodyInit });
      const r = await handleNewPost(webReq, env);
      applyEditorCors(req, res, env);
      return await sendFetchResponse(res, r);
    }

    // 3) 에디터 API 라우트 (/api/…)
    if (path.startsWith("/api/")) {
      const publicOk = isPublicApiGet(req, url); // 🔑 공개 GET이면 인증 생략
      if (!publicOk) {
        const tok = getEditorTokenFromHeaders(req);
        if (!tok || tok !== (env.EDITOR_PASSWORD || "").trim()) {
          applyEditorCors(req, res, env);
          setSecurityHeadersVercel(res);
          return res.status(401).json({ error: "Unauthorized" });
        }
      }

      // 원본 요청을 WHATWG Request로 변환해서 editor API에 위임
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (Array.isArray(v)) headers.set(k, v.join(", "));
        else if (typeof v === "string") headers.set(k, v);
      }

      let bodyInit: BodyInit | undefined;
      if (req.method !== "GET" && req.method !== "HEAD") {
        if (Buffer.isBuffer(req.body)) {
          bodyInit = new Uint8Array(req.body);
        } else if (typeof req.body === "string") {
          bodyInit = req.body;
        } else if (req.body == null) {
          // ⬇⬇ JSON 바디가 req.body에 없을 때 스트림에서 직접 읽기
          const chunks: Buffer[] = [];
          for await (const chunk of req as any) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          if (chunks.length) {
            bodyInit = Buffer.concat(chunks);
            // content-type이 비어 있으면 JSON으로 가정
            if (!headers.has("content-type")) headers.set("content-type", "application/json");
          }
        } else {
          // 객체로 파싱돼 온 경우
          if (!headers.has("content-type")) headers.set("content-type", "application/json");
          bodyInit = JSON.stringify(req.body);
        }
      }

      const webReq = new Request(url.toString(), { method: req.method, headers, body: bodyInit });
      const r = await handleEditorApi(webReq, env);
      applyEditorCors(req, res, env);
      return await sendFetchResponse(res, r);
    }


    // 4) 에디터 HTML
    if (path === "/editor" && req.method === "GET") {
      let html = renderEditorHTML({ version: process.env.EDITOR_ASSET_VER || "v12" });
      if (!/\/assets\/editor\.js/.test(html)) {
        const inject = `<script src="/assets/editor.js" defer></script>`;
        html = html.includes("</body>") ? html.replace("</body>", `${inject}\n</body>`) : `${html}\n${inject}\n`;
      }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      setSecurityHeadersVercel(res);
      return res.status(200).send(html);
    }

    // 5) 공개 라우트 (HTML: site.js 주입 + no-store)
    if (path === "/" || path === "/index.html") {
      const page = Number(url.searchParams.get("page") || "1");
      const r = await renderIndex(env as any, page);
      return await sendFetchResponse(res, await withNoStore(await withSiteJs(r)));
    }
    if (path === "/rss.xml") {
      const base = (env.SITE_URL && env.SITE_URL.replace(/\/+$/, "")) || `${proto}://${req.headers.host}`;
      const r = await renderRSS({ ...env, SITE_URL: base } as any);
      const hasType = r.headers.get("content-type");
      if (!hasType) {
        const rr = new Response(await r.text(), {
          status: r.status,
          headers: { "content-type": "application/rss+xml; charset=utf-8" },
        });
        return await sendFetchResponse(res, rr);
      }
      return await sendFetchResponse(res, r);
    }
    const mPost = path.match(/^\/post\/([^/]+)\/?$/);
    if (mPost) {
      const r = await renderPost(env as any, decodeURIComponent(mPost[1]!), url.searchParams);
      return await sendFetchResponse(res, await withNoStore(await withSiteJs(r)));
    }
    const mTag = path.match(/^\/tag\/([^/]+)\/?$/);
    if (mTag) {
      const page = Number(url.searchParams.get("page") || "1");
      const r = await renderTag(env as any, decodeURIComponent(mTag[1]!), page);
      return await sendFetchResponse(res, await withNoStore(await withSiteJs(r)));
    }

    // 6) 단일 세그먼트 페이지(/about 등)
    {
      const p = path.replace(/\/+$/, "/");
      const single = /^\/([^/]+)\/?$/.test(p);
      const last = p.split("/").filter(Boolean).pop() || "";
      const looksFile = last.includes(".");
      const reserved = ["/api/", "/assets/", "/post/", "/tag/", "/editor", "/rss.xml", "/favicon", "/robots.txt", "/sitemap.xml"];
      const isReserved = reserved.some((r) => p === r || p.startsWith(r));
      if (p !== "/" && single && !looksFile && !isReserved) {
        const slug = decodeURIComponent(p.replace(/^\/|\/$/g, ""));
        const r = await renderPage(env as any, slug, url.searchParams);
        return await sendFetchResponse(res, await withNoStore(await withSiteJs(r)));
      }
    }

    // 7) 404
    setSecurityHeadersVercel(res);
    return res.status(404).send("Not found");
  } catch (e: any) {
    setSecurityHeadersVercel(res);
    const msg = e?.message || String(e);
    const stack = e?.stack || "";
    const debug = String(process.env.ALLOW_DEBUG || "").toLowerCase() === "true";
    res.setHeader("content-type", "text/plain; charset=utf-8");
    return res.status(500).send(debug ? `Internal Error: ${msg}\n\n${stack}` : `Internal Error: ${msg}`);
  }
}

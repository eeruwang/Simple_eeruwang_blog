// routes/public/post.ts
/* ───────── 포스트 라우트 (API 버전) ─────────
 * - /post/:slug 에서 글 상세 조회
 * - 공개 API(/api/posts?slug=)에서 불러와 렌더
 * - is_page=true는 제외, published=true만 허용
 */

import { renderPostPage } from "../../views/pageview.js";
import { seoTags } from "../../lib/seo.js";
import { deriveExcerptFromRecord } from "../../lib/excerpt.js";

import { createDb } from "../../lib/api/editor.js";                      // DB 접근
import { resolveBibtexConfig } from "../../lib/bibtex/config.js";       // env→DB 설정 해석
import { processBib } from "../../lib/bibtex/bibtex.js";                 // 인용 치환 + 참고문헌

type Env = {
  SITE_URL?: string;
  SITE_NAME?: string;
  [k: string]: unknown;
};

type ApiPost = {
  id: number;
  slug: string;
  title: string;
  body_md?: string;
  tags?: string[];
  excerpt?: string | null;
  is_page?: boolean;
  published?: boolean;
  published_at?: string | null;
  cover_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** HTML Response의 </head> 직전에 headExtra를 주입 */
async function withSeoHead(resp: Response, headExtra: string): Promise<Response> {
  const ct = resp.headers.get("content-type") || "";
  if (!/text\/html/i.test(ct)) return resp;

  const html = await resp.text();
  if (!html.includes("</head>")) {
    return new Response(html, { status: resp.status, headers: resp.headers });
  }
  const patched = html.replace("</head>", `${headExtra}\n</head>`);
  const h = new Headers(resp.headers);
  if (!h.get("content-type")) h.set("content-type", "text/html; charset=utf-8");
  return new Response(patched, { status: resp.status, headers: h });
}

/** 본문 하단에 bibliographyHtml을 주입 */
async function withBibliography(resp: Response, bibliographyHtml: string): Promise<Response> {
  if (!bibliographyHtml) return resp;
  const ct = resp.headers.get("content-type") || "";
  if (!/text\/html/i.test(ct)) return resp;

  const html = await resp.text();
  if (html.includes('class="bibliography"')) {
    return new Response(html, { status: resp.status, headers: resp.headers });
  }

  // 우선순위: </article> → </main> → </body> 직전
  let patched = html;
  const ins = (needle: RegExp) => {
    const next = patched.replace(needle, `${bibliographyHtml}\n$&`);
    const changed = next !== patched;
    patched = next;
    return changed;
  };
  if (!ins(/<\/article>/i)) if (!ins(/<\/main>/i)) ins(/<\/body>/i);

  const h = new Headers(resp.headers);
  if (!h.get("content-type")) h.set("content-type", "text/html; charset=utf-8");
  return new Response(patched, { status: resp.status, headers: h });
}


function baseUrl(env: Env): string {
  // SITE_URL이 프로토콜 없이 오면 https:// 붙여서 절대 URL로
  let raw = String(env.SITE_URL || (globalThis as any).process?.env?.SITE_URL || "").trim();
  if (raw) {
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    return raw.replace(/\/+$/, "");
  }
  const vurl = (globalThis as any).process?.env?.VERCEL_URL;
  if (vurl) return `https://${String(vurl).replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

async function fetchPublicPostBySlug(env: Env, slug: string): Promise<ApiPost | null> {
  const base = baseUrl(env);
  const url = `${base}/api/posts?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url, { headers: { "cache-control": "no-store" } });
  if (!res.ok) return null;
  const j = await res.json();
  const item: ApiPost | undefined = j?.item;
  if (!item) return null;

  if (item.published !== true || item.is_page === true) return null;
  return item;
}

export async function renderPost(
  env: Env,
  slug: string,
  searchParams?: URLSearchParams
): Promise<Response> {
  const s = String(slug || "").trim();
  if (!s) return new Response("Not found", { status: 404 });

  const debug = !!searchParams?.get?.("debug");

  const rec = await fetchPublicPostBySlug(env, s);
  if (!rec) return new Response("Not found", { status: 404 });

  // ★★★ BibTeX 설정 해석(env 우선, 없으면 DB) + 본문 인용 치환
  let bibHtml = "";
  try {
    const db = createDb(env as any);
    const { url: bibUrl, style } = await resolveBibtexConfig(env as any, db);

    if (bibUrl) {
      const { content, bibliographyHtml } = await processBib(rec.body_md || "", bibUrl, {
        style: style || "harvard",
        usageHelp: true,
        ibid: true,
      });
      rec.body_md = content;        // ← 인용이 치환된 마크다운으로 교체
      bibHtml = bibliographyHtml;   // ← 렌더 단계에서 본문 하단에 붙임
    }
  } catch (e) {
    // 설정/파싱 실패는 페이지 렌더를 막지 않음
    console.warn("[post] bibtex process skipped:", e);
  }

  // ✅ siteUrl을 항상 절대 URL로 보장해서 seoTags에 넘김
  const site = baseUrl(env);
  const desc = rec.excerpt || deriveExcerptFromRecord(rec as any, 160) || "";

  const headExtra = seoTags({
    siteUrl: site,
    path: `/post/${encodeURIComponent(rec.slug)}`,
    title: rec.title || rec.slug || "Untitled",
    description: desc,
    imageUrl: rec.cover_url || undefined,
    type: "article",
  });

    // ── BibTeX 처리(본문에 [@key] 패턴이 있을 때만)
  let bibliographyHtml = "";
  try {
    if (/\[[^\]]*@/.test(rec.body_md || "")) {
      const db = createDb(env as any);
      const { url: bibUrl, style } = await resolveBibtexConfig(env as any, db);
      if (bibUrl) {
        const { content, bibliographyHtml: bibHtml } = await processBib(
          rec.body_md || "",
          bibUrl,
          { style: style || "harvard", usageHelp: true, ibid: true }
        );
        rec.body_md = content;
        bibliographyHtml = bibHtml;
      }
    }
  } catch (e) {
    console.warn("[post] bibtex skipped:", e);
  }

  // 렌더 → 참고문헌 주입 → SEO 주입
  const r0 = await renderPostPage(env, rec as any, debug);
  const r1 = await withBibliography(r0, bibliographyHtml);
  return await withSeoHead(r1, headExtra);
}

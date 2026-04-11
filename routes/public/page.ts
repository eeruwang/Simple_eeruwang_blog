/* ───────── 페이지 라우트 (DB 직접 호출) ─────────
 * - /:slug 에서 is_page=true인 레코드를 DB에서 직접 조회
 * - published=true만 기본 허용. ?draft=1/?preview=1/?debug=1 은 에디터 토큰이
 *   있을 때만 드래프트 접근 허용(이전 버전은 무인증으로 드래프트가 보였음).
 */

import { renderPostPage } from "../../views/pageview.js";
import { seoTags } from "../../lib/seo.js";
import { deriveExcerptFromRecord } from "../../lib/excerpt.js";

import { createDb } from "../../lib/api/editor.js";
import { resolveBibtexConfig } from "../../lib/bibtex/config.js";
import { processBib } from "../../lib/bibtex/bibtex.js";
import { withBibliography } from "../../lib/util.js";
import { getPageBySlug } from "../../lib/db/db.js";

type Env = {
  SITE_URL?: string;
  SITE_NAME?: string;
  EDITOR_PASSWORD?: string;
  [k: string]: unknown;
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

function baseUrl(env: Env): string {
  let raw = String(env.SITE_URL || (globalThis as any).process?.env?.SITE_URL || "").trim();
  if (raw) {
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    return raw.replace(/\/+$/, "");
  }
  const vurl = (globalThis as any).process?.env?.VERCEL_URL;
  if (vurl) return `https://${String(vurl).replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export async function renderPage(
  env: Env,
  slug: string,
  searchParams?: URLSearchParams,
  editorToken?: string
): Promise<Response> {
  const s = String(slug || "").trim();
  if (!s) return new Response("Not found", { status: 404 });

  const debug = !!searchParams?.get?.("debug");

  // 드래프트/프리뷰는 반드시 에디터 토큰을 요구(이전에는 무인증 노출 버그).
  const pass = String(env.EDITOR_PASSWORD || (globalThis as any).process?.env?.EDITOR_PASSWORD || "").trim();
  const tok = String(editorToken || "").trim();
  const isEditor = !!pass && !!tok && tok === pass;
  const wantsDraft =
    searchParams?.get?.("draft") === "1" ||
    searchParams?.get?.("preview") === "1" ||
    searchParams?.get?.("debug") === "1";
  const includeDraft = wantsDraft && isEditor;

  const rec = await getPageBySlug(s, { includeDraft });
  if (!rec) return new Response("Not found", { status: 404 });

  // ── BibTeX: env → DB 순으로 URL 해석 → 인용 치환 + 참고문헌 생성
    // ── BibTeX: 1회만 처리
  let bibliographyHtml = "";
  try {
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
  } catch (e) {
    console.warn("[post] bibtex process skipped:", e);
  }


  // SEO/OG 메타 주입(페이지는 website 타입이 일반적)
  const site = baseUrl(env);
  const desc = rec.excerpt || deriveExcerptFromRecord(rec as any, 160) || "";
  const headExtra = seoTags({
    siteUrl: site,
    path: `/${encodeURIComponent(rec.slug)}`,
    title: rec.title || rec.slug || "Untitled",
    description: desc,
    imageUrl: rec.cover_url || undefined,
    type: "website",
  });

  // 렌더 → 참고문헌 주입 → SEO
  const r0 = await renderPostPage(env, rec as any, debug);
  const r1 = await withBibliography(r0, bibliographyHtml);
  return await withSeoHead(r1, headExtra);
}
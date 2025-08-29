// routes/public/post.ts
/* ───────── 포스트 라우트 (Postgres 버전) ─────────
 * - /post/:slug 에서 글 상세 조회 (is_page=false)
 * - views/pageview.js의 renderPostPage()로 렌더
 */

import { getBySlug } from "../../lib/db/db.js";
import { renderPostPage } from "../../views/pageview.js";
import { seoTags } from "../../lib/seo.js";
import { deriveExcerptFromRecord } from "../../lib/excerpt.js";

type Env = {
  SITE_URL?: string;
  SITE_NAME?: string;
} & Record<string, unknown>;

/** HTML Response의 </head> 직전에 headExtra를 주입 */
async function withSeoHead(resp: Response, headExtra: string): Promise<Response> {
  const ct = resp.headers.get("content-type") || "";
  if (!/text\/html/i.test(ct)) return resp;

  const html = await resp.text();
  if (!html.includes("</head>")) {
    // head 없다면 그대로 반환
    return new Response(html, { status: resp.status, headers: resp.headers });
  }
  const patched = html.replace("</head>", `${headExtra}\n</head>`);
  const h = new Headers(resp.headers);
  if (!h.get("content-type")) h.set("content-type", "text/html; charset=utf-8");
  return new Response(patched, { status: resp.status, headers: h });
}

export async function renderPost(
  env: Env,
  slug: string,
  searchParams?: URLSearchParams
): Promise<Response> {
  const s = String(slug || "").trim();
  if (!s) return new Response("Not found", { status: 404 });

  const debug = !!searchParams?.get?.("debug");

  const rec = await getBySlug(s);
  // 페이지(is_page=true)는 제외
  if (!rec || rec.is_page) {
    return new Response("Not found", { status: 404 });
  }

  // SEO 메타 구성
  const site = (env.SITE_URL || "https://example.blog").replace(/\/+$/, "");
  const desc =
    rec.excerpt || deriveExcerptFromRecord(rec as any, 160) || "";
  const headExtra = seoTags({
    siteUrl: site,
    path: `/post/${encodeURIComponent(rec.slug)}`,
    title: rec.title || rec.slug || "Untitled",
    description: desc,
    imageUrl: rec.cover_url || undefined,
    type: "article",
  });

  // 기존 시그니처 유지 + SEO 주입
  const r = await renderPostPage(env, rec as any, debug);
  return await withSeoHead(r, headExtra);
}

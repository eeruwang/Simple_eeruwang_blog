/* ───────── 포스트 라우트 (API 버전) ─────────
 * - /post/:slug 에서 글 상세 조회
 * - 공개 API(/api/posts?slug=)에서 불러와 렌더
 * - is_page=true는 제외, published=true만 허용
 */

import { renderPostPage } from "../../views/pageview.js";
import { seoTags } from "../../lib/seo.js";
import { deriveExcerptFromRecord } from "../../lib/excerpt.js";

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

function baseUrl(env: Env): string {
  const fromSite = (env.SITE_URL || "").trim().replace(/\/+$/, "");
  if (fromSite) return fromSite;
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

  // 공개 글만 허용
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

  // SEO 메타 구성
  const site = (env.SITE_URL || "https://example.blog").replace(/\/+$/, "");
  const desc = rec.excerpt || deriveExcerptFromRecord(rec as any, 160) || "";
  const headExtra = seoTags({
    siteUrl: site,
    path: `/post/${encodeURIComponent(rec.slug)}`,
    title: rec.title || rec.slug || "Untitled",
    description: desc,
    imageUrl: rec.cover_url || undefined,
    type: "article",
  });

  const r = await renderPostPage(env, rec as any, debug);
  return await withSeoHead(r, headExtra);
}

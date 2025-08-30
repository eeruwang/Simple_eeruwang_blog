/* ───────── 페이지 라우트 (API 경유 버전) ─────────
 * - /:slug 에서 is_page=true인 레코드를 공개 API로 조회
 * - published=true만 기본 허용( ?preview=1 이면 초안 허용)
 * - views/pageview.js 의 renderPostPage 로 렌더
 * - post.ts 와 동일한 SEO/메타 주입 흐름으로 통일
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

const toBool = (v: unknown) =>
  v === true || v === 1 || v === "1" || v === "t" || v === "true";

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

async function fetchPublicPageBySlug(
  env: Env,
  slug: string,
  includeDraft?: boolean
): Promise<ApiPost | null> {
  const base = baseUrl(env);
  const qs = new URLSearchParams({ slug });
  if (includeDraft) qs.set("draft", "1"); // 공개 API가 지원한다면 사용
  const url = `${base}/api/posts?${qs.toString()}`;
  const res = await fetch(url, { headers: { "cache-control": "no-store" } });
  if (!res.ok) return null;
  const j = await res.json();
  const item: ApiPost | undefined = j?.item;
  if (!item) return null;

  // 페이지 전용 필터
  if (item.is_page !== true) return null;
  if (!includeDraft && item.published !== true) return null;
  return item;
}

export async function renderPage(
  env: Env,
  slug: string,
  searchParams?: URLSearchParams
): Promise<Response> {
  const s = String(slug || "").trim();
  if (!s) return new Response("Not found", { status: 404 });

  const debug = !!searchParams?.get?.("debug");
  const includeDraft =
    searchParams?.get?.("draft") === "1" ||
    searchParams?.get?.("preview") === "1" ||
    searchParams?.get?.("debug") === "1";

  // 공개 API 경유로 통일
  const rec = await fetchPublicPageBySlug(env, s, includeDraft);
  if (!rec) return new Response("Not found", { status: 404 });

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

  const r = await renderPostPage(env, rec as any, debug);
  return await withSeoHead(r, headExtra);
}

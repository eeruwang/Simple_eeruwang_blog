/* /:slug — 단일 페이지(About 등). 본문은 press.js가 채움 */

import { renderPostPage as renderPageView } from "../../views/pageview.js";
import { seoTags } from "../../lib/seo.js";
import { deriveExcerptFromRecord } from "../../lib/excerpt.js";

type Env = { SITE_URL?: string; SITE_NAME?: string; [k: string]: unknown };
type ApiPage = {
  id: number; slug: string; title: string;
  excerpt?: string | null; tags?: string[];
  is_page?: boolean; published?: boolean;
  published_at?: string | null; cover_url?: string | null;
  created_at?: string | null; updated_at?: string | null;
};

function baseUrl(env: Env): string {
  let raw = String(env.SITE_URL || (globalThis as any).process?.env?.SITE_URL || "").trim();
  if (raw) { if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw; return raw.replace(/\/+$/, ""); }
  const vurl = (globalThis as any).process?.env?.VERCEL_URL;
  return vurl ? `https://${String(vurl).replace(/\/+$/, "")}` : "http://localhost:3000";
}

async function withSeoHead(resp: Response, headExtra: string): Promise<Response> {
  const ct = resp.headers.get("content-type") || "";
  if (!/text\/html/i.test(ct)) return resp;
  const html = await resp.text();
  const patched = html.includes("</head>") ? html.replace("</head>", `${headExtra}\n</head>`) : html;
  const h = new Headers(resp.headers);
  if (!h.get("content-type")) h.set("content-type", "text/html; charset=utf-8");
  return new Response(patched, { status: resp.status, headers: h });
}

/** 공개 단건(페이지)만 */
async function fetchPublicPageBySlug(env: Env, slug: string): Promise<ApiPage | null> {
  const base = baseUrl(env);
  const url = `${base}/api/posts?slug=${encodeURIComponent(slug)}`;
  const res = await fetch(url, { headers: { "cache-control": "no-store" } });
  if (!res.ok) return null;
  const j = await res.json();
  const item: ApiPage | undefined = j?.item;
  if (!item) return null;
  if (item.is_page !== true || item.published !== true) return null; // 페이지이면서 공개만
  return item;
}

export async function renderPage(env: Env, slug: string, searchParams?: URLSearchParams): Promise<Response> {
  const s = String(slug || "").trim();
  if (!s) return new Response("Not found", { status: 404 });

  const rec = await fetchPublicPageBySlug(env, s);
  if (!rec) return new Response("Not found", { status: 404 });

  const site = baseUrl(env);
  const desc = rec.excerpt || deriveExcerptFromRecord(rec as any, 160) || "";

  const headExtra = seoTags({
    siteUrl: site,
    path: `/${encodeURIComponent(rec.slug)}`,
    title: rec.title || rec.slug || "Untitled",
    description: desc,
    imageUrl: rec.cover_url || undefined,
    type: "article",
  });

  const debug = !!searchParams?.get?.("debug");
  const shell = await renderPageView(env, rec as any, debug); // #content 빈 틀
  return await withSeoHead(shell, headExtra);
}

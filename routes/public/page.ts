// routes/public/page.ts
// 단일 페이지(/:slug)도 포스트와 동일하게 SSR로 본문을 주입

import { renderPostPage as renderPageView } from "../../views/pageview.js";
import { seoTags } from "../../lib/seo.js";
import { deriveExcerptFromRecord } from "../../lib/excerpt.js";
import { mdToHtml } from "../../lib/markdown.js";

type Env = {
  SITE_URL?: string;
  SITE_NAME?: string;
  EDITOR_PASSWORD?: string;
  [k: string]: unknown;
};

type ApiPage = {
  id: number;
  slug: string;
  title: string;
  excerpt?: string | null;
  tags?: string[];
  is_page?: boolean;
  published?: boolean;
  published_at?: string | null;
  cover_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  body_md?: string | null;     // ← 본문(MD)
  body_html?: string | null;   // ← 캐시/옵션
};

function baseUrl(env: Env): string {
  const raw = String(env.SITE_URL || (globalThis as any).process?.env?.SITE_URL || "").trim();
  if (raw) return (/^https?:\/\//i.test(raw) ? raw : "https://" + raw).replace(/\/+$/, "");
  const vurl = (globalThis as any).process?.env?.VERCEL_URL;
  return vurl ? `https://${String(vurl).replace(/\/+$/, "")}` : "";
}

// routes/public/page.ts — fetchPublicPageBySlug 교체
async function fetchPublicPageBySlug(env: Env, slug: string): Promise<ApiPage | null> {
  const base = baseUrl(env);
  const headers: Record<string,string> = { "cache-control":"no-store" };
  const tok = String((env as any).EDITOR_PASSWORD || "").trim();
  if (tok) headers["x-editor-token"] = tok;

  // 1) slug로 얕은 레코드
  const r = await fetch(`${base}/api/posts?slug=${encodeURIComponent(slug)}`, { headers });
  if (!r.ok) return null;
  const j = await r.json().catch(()=>null);
  let item = j?.item as ApiPage | undefined;
  if (!item) return null;
  if (item.is_page !== true || item.published !== true) return null;

  // 2) 본문이 없으면 id로 단건 재조회(본문 포함)
  const hasBody = typeof (item as any).body_md === "string" || typeof (item as any).bodyMd === "string";
  if (!hasBody && item.id) {
    const r2 = await fetch(`${base}/api/posts/${item.id}`, { headers });
    if (r2.ok) {
      const j2 = await r2.json().catch(()=>null);
      const full = (j2?.item || j2?.record || j2) as any;
      if (full) item = { ...item, body_md: full.body_md ?? full.bodyMd ?? null, body_html: full.body_html ?? full.bodyHtml ?? null };
    }
  }
  return item;
}


// <head>에 SEO 태그 삽입
async function withSeoHead(resp: Response, headExtra: string): Promise<Response> {
  const ct = resp.headers.get("content-type") || "";
  if (!/text\/html/i.test(ct)) return resp;
  const html = await resp.text();
  const patched = html.includes("</head>")
    ? html.replace("</head>", `${headExtra}\n</head>`)
    : html;
  const h = new Headers(resp.headers);
  if (!h.get("content-type")) h.set("content-type", "text/html; charset=utf-8");
  return new Response(patched, { status: resp.status, headers: h });
}

// 서버 렌더된 틀(#content)에 본문 HTML 꽂기
async function withContentHTML(resp: Response, bodyHtml: string): Promise<Response> {
  const ct = resp.headers.get("content-type") || "";
  if (!/text\/html/i.test(ct)) return resp;
  const src = await resp.text();

  const tagRx = /<div\b[^>]*\bid\s*=\s*["']content["'][^>]*>/i;
  if (!tagRx.test(src)) return resp;               // 틀에 #content가 없다면 원본 반환
  const out = src.replace(tagRx, (m) => m + (bodyHtml || ""));  // 오픈 태그 직후에 꽂기

  const h = new Headers(resp.headers);
  if (!h.get("content-type")) h.set("content-type", "text/html; charset=utf-8");
  return new Response(out, { status: resp.status, headers: h });
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
  const shell = await renderPageView(env, rec as any, debug);
  const bodyHtml =
    typeof (rec as any).body_html === "string" && (rec as any).body_html.trim()
      ? (rec as any).body_html!
      : mdToHtml(rec.body_md || "");

  const withBody = await withContentHTML(shell, bodyHtml);
  return await withSeoHead(withBody, headExtra);
}

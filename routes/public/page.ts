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

async function fetchPublicPageBySlug(env: Env, slug: string): Promise<ApiPage | null> {
  const base = baseUrl(env);
  const url = `${base}/api/posts?slug=${encodeURIComponent(slug)}`;
  const headers: Record<string, string> = { "cache-control": "no-store" };
  // 서버에서 초안 미리보기 허용하려면 에디터 토큰을 붙일 수 있음(공개 페이지만 통과됨)
  const tok = String((env as any).EDITOR_PASSWORD || "").trim();
  if (tok) headers["x-editor-token"] = tok;

  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  const item = j?.item as ApiPage | undefined;
  if (!item) return null;
  // 페이지이면서 공개글만 렌더
  if (item.is_page !== true || item.published !== true) return null;
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
  const idx = src.indexOf('<div id="content"');
  if (idx < 0) return resp;
  const gt = src.indexOf(">", idx);
  const html = src.slice(0, gt + 1) + (bodyHtml || "") + src.slice(gt + 1);
  const h = new Headers(resp.headers);
  if (!h.get("content-type")) h.set("content-type", "text/html; charset=utf-8");
  return new Response(html, { status: resp.status, headers: h });
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

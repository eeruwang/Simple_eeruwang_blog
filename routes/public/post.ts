// routes/public/post.ts
/* ───────── 포스트 라우트 (API 버전) ─────────
 * - /post/:slug 에서 글 상세 조회
 * - 공개 API(/api/posts?slug=)에서 불러와 렌더
 * - is_page=true는 제외, published=true만 허용
 */

import { renderPostPage } from "../../views/pageview.js";
import { seoTags } from "../../lib/seo.js";
import { deriveExcerptFromRecord } from "../../lib/excerpt.js";

import { createDb } from "../../lib/db/bootstrap.js";
import { resolveBibtexConfig } from "../../lib/bibtex/config.js";       // env→DB 설정 해석
import { processBib } from "../../lib/bibtex/bibtex.js";                 // 인용 치환 + 참고문헌
import { withBibliography } from "../../lib/util.js"; 

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

/** 본문 HTML을 안전하게 #content 안으로 주입 */
async function withContentHTML(resp: Response, bodyHtml: string): Promise<Response> {
  const ct = resp.headers.get("content-type") || "";
  if (!/text\/html/i.test(ct)) return resp;

  const src = await resp.text();
  let html = src;

  // 0) __BIB_HERE__ 마커가 있으면 "앞"에 꽂기
  if (html.includes("<!-- __BIB_HERE__ -->")) {
    html = html.replace("<!-- __BIB_HERE__ -->", `${bodyHtml || ""}\n<!-- __BIB_HERE__ -->`);
  } else {
    // 1) <div id="content"...> 바로 뒤에 꽂기
    const idx = html.indexOf('<div id="content"');
    if (idx >= 0) {
      const gt = html.indexOf(">", idx);
      if (gt > idx) {
        html = html.slice(0, gt + 1) + (bodyHtml || "") + html.slice(gt + 1);
      }
    } else {
      // 2) 못 찾으면 </article> 앞에 꽂기(최후보루)
      const aidx = html.lastIndexOf("</article>");
      if (aidx >= 0) {
        html = html.slice(0, aidx) + (bodyHtml || "") + html.slice(aidx);
      }
    }
  }

  const h = new Headers(resp.headers);
  if (!h.get("content-type")) h.set("content-type", "text/html; charset=utf-8");
  return new Response(html, { status: resp.status, headers: h });
}

/** 아주 심플한 서버측 Markdown→HTML (body_html이 있으면 그걸 우선 사용) */
function mdToHtml(md?: string, fallbackHtml?: string): string {
  if (fallbackHtml) return fallbackHtml;
  if (!md) return "";
  let h = md;

  // ```code```
  h = h.replace(/```([\s\S]*?)```/g, (_match: string, code: string) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
    const esc = code.replace(/[&<>]/g, (ch: string) => map[ch]);
    return `<pre><code>${esc}</code></pre>`;
  });

  // 이미지/링크
  h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, `<img alt="$1" src="$2">`);
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `<a href="$2">$1</a>`);

  // 헤딩
  h = h.replace(/^(#{1,6})\s*(.+)$/gm, (_match: string, sharp: string, text: string) => {
    const lvl = Math.min(6, sharp.length);
    return `<h${lvl}>${text}</h${lvl}>`;
  });

  // 굵게/기울임
  h = h.replace(/\*\*([^*]+)\*\*/g, `<strong>$1</strong>`);
  h = h.replace(/\*([^*]+)\*/g, `<em>$1</em>`);

  // 문단
  h = h
    .split(/\n{2,}/)
    .map(p => (/^\s*<(h\d|pre|ul|ol|blockquote|table|img|p|figure|div)\b/i.test(p) ? p : `<p>${p}</p>`))
    .join("\n");

  return h;
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
  // ▼ Markdown → HTML (BibTeX 반영된 rec.body_md 기준)
  const bodyHtml = mdToHtml(rec.body_md || "", (rec as any).body_html);

  // 1) 기본 페이지 렌더
  const r0 = await renderPostPage(env, rec as any, debug);
  // 2) 본문 주입
  const rContent = await withContentHTML(r0, bodyHtml);
  // 3) 참고문헌 주입 → 4) SEO 주입
  const r1 = await withBibliography(rContent, bibliographyHtml);
  return await withSeoHead(r1, headExtra);
}

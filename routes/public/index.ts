/* ───────── 메인 인덱스 (API 버전) ─────────
 * - 공개 API(/api/posts)에서 글을 가져와 렌더
 * - 상단 태그 레일 + 클라이언트 필터 스크립트
 * - 페이지네이션: API에서 충분히 가져온 뒤 필터/슬라이스
 */

import { pageHtml } from "../../lib/render/render.js";
import { escapeAttr, escapeHtml } from "../../lib/util.js";
import { getTags, tagsHtml } from "../../lib/render/tags.js";
import { renderTagBar, getConfiguredTags, TAG_SCRIPT } from "../../lib/render/tags-ui.js";
import { deriveExcerptFromRecord } from "../../lib/excerpt.js";
import { renderBannerRail } from "../../lib/render/banners.js";

type Env = {
  SITE_NAME?: string;
  SITE_URL?: string; // 배포 도메인(절대 URL 만들 때 사용)
  NOTES_TAGS?: string;
  SITE_BANNERS?: string;
  BANNERS_JSON_URL?: string;
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

function baseUrl(env: Env): string {
  const fromSite = (env.SITE_URL || "").trim().replace(/\/+$/, "");
  if (fromSite) return fromSite;
  const vurl = (globalThis as any).process?.env?.VERCEL_URL;
  if (vurl) return `https://${String(vurl).replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

/** 공개 글만 필터하고 날짜 내림차순 정렬 */
function toPublicSorted(list: ApiPost[]): ApiPost[] {
  const onlyPublic = (list || []).filter(
    (it) => it && it.published === true && it.is_page !== true
  );
  onlyPublic.sort((a, b) => {
    const ad = new Date(a.published_at || a.updated_at || a.created_at || 0).getTime();
    const bd = new Date(b.published_at || b.updated_at || b.created_at || 0).getTime();
    return bd - ad;
  });
  return onlyPublic;
}

/** 메인 리스트용 데이터 가져오기: 충분히 가져온 뒤 페이지 슬라이스 */
async function fetchPublicPosts(env: Env, page = 1, perPage = 10) {
  const base = baseUrl(env);

  // 현재 페이지를 정확히 만들기 위해 넉넉히 가져옴(최대 1000)
  const need = Math.min(Math.max(page * perPage + 1, 50), 1000);
  const api = `${base}/api/posts?limit=${need}&offset=0`;
  const res = await fetch(api, { headers: { "cache-control": "no-store" } });
  if (!res.ok) throw new Error(`posts fetch failed: ${res.status}`);
  const j = await res.json();
  const all: ApiPost[] = Array.isArray(j.list) ? j.list : [];

  const pubSorted = toPublicSorted(all);
  const start = (page - 1) * perPage;
  const pageSlice = pubSorted.slice(start, start + perPage);
  const hasNext = pubSorted.length > start + perPage;

  return { items: pageSlice, hasNext };
}

export async function renderIndex(env: Env, page: number = 1): Promise<Response> {
  const perPage = 10;

  const { items: list, hasNext } = await fetchPublicPosts(env, page, perPage);
  const tagButtons = getConfiguredTags(env);

  const itemsHtml = list
    .map((r) => {
      const slug = (r.slug || "").trim();
      const title = r.title || "(제목 없음)";
      const dateIso = r.published_at || r.updated_at || r.created_at || null;
      const dateStr = dateIso ? new Date(dateIso).toLocaleDateString("en-GB") : "";
      const coverSrc = r.cover_url || "";
      const excerpt = (r.excerpt || deriveExcerptFromRecord(r as any, 160) || "").trim();
      const dataTags = getTags(r as any).map((t) => String(t).trim()).filter(Boolean).join(",");

      return `<article class="post" data-tags="${escapeAttr(dataTags)}">
        ${coverSrc ? `<img class="cover" src="${escapeAttr(coverSrc)}" alt="">` : ""}
        <div class="title-row list">
          <h2 class="title"><a href="/post/${encodeURIComponent(slug)}">${escapeHtml(title)}</a></h2>
          ${tagsHtml(r as any)}
          <div class="meta" style="margin-left:auto">${escapeHtml(dateStr)}</div>
        </div>
        ${excerpt ? `<p class="excerpt">${escapeHtml(excerpt)}</p>` : ""}
      </article>`;
    })
    .join("");

  const pager = `<nav style="display:flex;gap:12px;margin-top:18px">
    ${page > 1 ? `<a href="/?page=${page - 1}">« 이전</a>` : ""}
    ${hasNext ? `<a href="/?page=${page + 1}">다음 »</a>` : ""}
  </nav>`;

  const bannerRailHtml = await renderBannerRail({
    SITE_BANNERS: (env as any)?.SITE_BANNERS,
    BANNERS_JSON_URL: (env as any)?.BANNERS_JSON_URL,
    SITE_URL: env.SITE_URL,
  });

  const html = pageHtml(
    {
      title: env.SITE_NAME || "이루왕의 잡동사니",
      headExtra: `<script src="/assets/press.js" defer></script>`,
      body: `
        ${renderTagBar("all", tagButtons)}
        <div id="post-list">${itemsHtml || "<p>글이 없습니다.</p>"}</div>
        ${pager}
        ${bannerRailHtml}
        <script>${TAG_SCRIPT}</script>
      `,
    },
    env as any
  );

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store", // 발행 즉시 반영
    },
  });
}

/* ───────── 메인 인덱스 (Postgres 버전) ─────────
 * - 최근 글을 Postgres에서 불러와 카드 형태로 렌더
 * - 상단 태그 레일 + 클라이언트 필터 스크립트
 * - 페이지네이션(look-ahead)로 다음 페이지 유무 판단
 */

import { pageHtml } from "../../lib/render/render.js";
import { escapeAttr, escapeHtml } from "../../lib/util.js";
import { getTags, tagsHtml } from "../../lib/render/tags.js";
import { renderTagBar, getConfiguredTags, TAG_SCRIPT } from "../../lib/render/tags-ui.js";
import { deriveExcerptFromRecord } from "../../lib/excerpt.js";
import { listPosts, type PostRow, asArrayRows } from "../../lib/db/db.js";
import { renderBannerRail } from "../../lib/render/banners.js";

type Env = {
  SITE_NAME?: string;
  SITE_URL?: string;
  NOTES_TAGS?: string;
  SITE_BANNERS?: string;
  BANNERS_JSON_URL?: string;
};

export async function renderIndex(env: Env, page: number = 1): Promise<Response> {
  const perPage = 10;

  // look-ahead: perPage+1 로 가져와 다음 페이지 유무 판별
  const raw = await listPosts(page, perPage + 1);
  const rows: PostRow[] = asArrayRows<PostRow>(raw);
  const hasNext = rows.length > perPage;
  const list = rows.slice(0, perPage);

  const tagButtons = getConfiguredTags(env);

  const items = list
    .map((r) => {
      const slug = (r.slug || "").trim();
      const title = r.title || "(제목 없음)";
      const dateIso = r.published_at || r.created_at || null;
      const dateStr = dateIso ? new Date(dateIso).toLocaleDateString("en-GB") : "";
      const coverSrc = r.cover_url || "";
      const excerpt = (r.excerpt || deriveExcerptFromRecord(r, 160) || "").trim();
      const dataTags = getTags(r).map((t) => String(t).trim()).filter(Boolean).join(",");

      return `<article class="post" data-tags="${escapeAttr(dataTags)}">
        ${coverSrc ? `<img class="cover" src="${escapeAttr(coverSrc)}" alt="">` : ""}
        <div class="title-row list">
          <h2 class="title"><a href="/post/${encodeURIComponent(slug)}">${escapeHtml(title)}</a></h2>
          ${tagsHtml(r)}
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
        <div id="post-list">${items || "<p>글이 없습니다.</p>"}</div>
        ${pager}
        ${bannerRailHtml}
        <script>${TAG_SCRIPT}</script>
      `,
    },
    env as any
  );

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

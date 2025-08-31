/* ───────── 태그 라우트 (Postgres 버전) ─────────
 * - /tag/:tag 목록을 Postgres에서 조회 (게시글만, 페이지 제외)
 * - 서버 페이지네이션 + 클라이언트 필터 UI 유지
 */

import { pageHtml } from "../../lib/render/render.js";
import { escapeAttr, escapeHtml } from "../../lib/util.js";
import { getTags, tagsHtml } from "../../lib/render/tags.js";
import { renderTagBar, getConfiguredTags } from "../../lib/render/tags-ui.js";
import { renderBannerRail } from "../../lib/render/banners.js";
import { deriveExcerptFromRecord } from "../../lib/excerpt.js";
import { listByTag, type PostRow, asArrayRows } from "../../lib/db/db.js";

type Env = {
  SITE_NAME?: string;
  SITE_URL?: string;
  NOTES_TAGS?: string;
  SITE_BANNERS?: string;
  BANNERS_JSON_URL?: string;
};

export async function renderTag(env: Env, tag: string, page: number = 1): Promise<Response> {
  const perPage = 10;
  const tNorm = String(tag || "").trim().toLowerCase();
  if (!tNorm) return new Response("Not found", { status: 404 });

  // look-ahead: 다음 페이지 유무 계산을 위해 perPage+1개 요청
  const raw = await listByTag(tNorm, page, perPage + 1);
  const rows: PostRow[] = asArrayRows<PostRow>(raw);
  const hasNext = rows.length > perPage;
  const pageItems = rows.slice(0, perPage);

  const hasPrev = page > 1;
  const tagButtons = getConfiguredTags(env);

  const items = pageItems
    .map((r) => {
      const slug = (r.slug || "").trim();
      const title = r.title || "(제목 없음)";
      const dateIso = r.published_at || r.created_at || null;
      const dateStr = dateIso ? new Date(dateIso).toLocaleDateString("en-GB") : "";
      const coverSrc = r.cover_url || "";
      const excerpt = (r.excerpt || deriveExcerptFromRecord(r as any, 160) || "").trim();
      const dataTags = getTags(r).map((x) => String(x).trim()).filter(Boolean).join(",");

      return `<article class="post" data-tags="${escapeAttr(dataTags)}">
        ${coverSrc ? `<img class="cover" src="${escapeAttr(coverSrc)}" alt="">` : ""}
        <h2 class="title"><a href="/post/${encodeURIComponent(slug)}">${escapeHtml(title)}</a></h2>
        <div class="row"><div class="meta">${escapeHtml(dateStr)}</div>${tagsHtml(r)}</div>
        ${excerpt ? `<p class="excerpt">${escapeHtml(excerpt)}</p>` : ""}
      </article>`;
    })
    .join("");

  const pager = `<nav style="display:flex;gap:12px;margin-top:18px">
    ${hasPrev ? `<a href="/tag/${encodeURIComponent(tag)}?page=${page - 1}">« 이전</a>` : ""}
    ${hasNext ? `<a href="/tag/${encodeURIComponent(tag)}?page=${page + 1}">다음 »</a>` : ""}
  </nav>`;

  const bannerRailHtml = await renderBannerRail({
    SITE_BANNERS: env.SITE_BANNERS,
    BANNERS_JSON_URL: env.BANNERS_JSON_URL,
    SITE_URL: env.SITE_URL,
  });

  const html = pageHtml(
    {
      title: `태그: ${tag}`,
      headExtra: `<script src="/assets/press.js" defer></script>`,
      body: `
        ${renderTagBar(tag, tagButtons)}
        <div id="post-list">${items || "<p>글이 없습니다.</p>"}</div>
        ${pager}
        ${bannerRailHtml}
      `,
    },
    env as any
  );

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

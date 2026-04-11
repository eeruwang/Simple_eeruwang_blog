/* ───────── 태그 라우트 (Postgres 버전) ─────────
 * - /tag/:tag 목록을 Postgres에서 조회 (게시글만, 페이지 제외)
 * - 서버 페이지네이션 + 클라이언트 필터 UI 유지
 */

import { pageHtml } from "../../lib/render/render.js";
import { escapeAttr, escapeHtml } from "../../lib/util.js";
import { getTags, tagsHtml } from "../../lib/render/tags.js";
import { renderTagBar, getConfiguredTags, TAG_SCRIPT } from "../../lib/render/tags-ui.js";
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

async function fetchAllTags(env: Env): Promise<string[]> {
  try {
    let raw = String(env.SITE_URL || (globalThis as any).process?.env?.SITE_URL || "").trim();
    if (raw && !/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    const base = (raw || "http://localhost:3000").replace(/\/+$/, "");
    const res = await fetch(`${base}/api/tags`, { headers: { "cache-control": "no-store" } });
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j?.tags) ? j.tags : [];
  } catch {
    return [];
  }
}

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
  const dbTags = await fetchAllTags(env);
  const tagButtons = dbTags.length ? dbTags : getConfiguredTags(env);

  const items = pageItems
    .map((r) => {
      const slug = (r.slug || "").trim();
      const title = r.title || "(제목 없음)";
      const excerpt = (r.excerpt || deriveExcerptFromRecord(r as any, 160) || "").trim();
      const postTags = getTags(r).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
      const dataTags = postTags.join(",");
      const isPaper = postTags.includes("paper");
      const cls = isPaper ? "paper" : "note";

      if (isPaper) {
        return `<a href="/post/${encodeURIComponent(slug)}" class="${cls}" data-tags="${escapeAttr(dataTags)}">
          <h3>${escapeHtml(title)}</h3>
          ${excerpt ? `<p class="description">${escapeHtml(excerpt)}</p>` : ""}
        </a>`;
      }
      return `<a href="/post/${encodeURIComponent(slug)}" class="${cls}" data-tags="${escapeAttr(dataTags)}">
        <h3>${escapeHtml(title)}</h3>${excerpt ? `<p class="description">${escapeHtml(excerpt)}</p>` : ""}
      </a>`;
    })
    .join("");

  const pager = `<nav class="pager">
    ${hasPrev ? `<a href="/tag/${encodeURIComponent(tag)}?page=${page - 1}">&larr; Previous</a>` : ""}
    ${hasNext ? `<a href="/tag/${encodeURIComponent(tag)}?page=${page + 1}">Next &rarr;</a>` : ""}
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
        <script>${TAG_SCRIPT}</script>
      `,
    },
    env as any
  );

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

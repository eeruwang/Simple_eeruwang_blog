/* ───────── 메인 인덱스 (DB 직접 호출 버전) ─────────
 * - 이전 버전은 자기 자신의 /api/posts로 HTTP 루프백 fetch를 보냈습니다.
 *   Vercel 서버리스에선 매 요청마다 별도 함수 호출이 되어 상당한 오버헤드
 *   + 편집자 토큰 노출 위험이 있어 제거했습니다.
 * - 이제 lib/db/db.ts의 listPostsPaged/listAllTags를 직접 호출합니다.
 */

import { pageHtml } from "../../lib/render/render.js";
import { escapeAttr, escapeHtml } from "../../lib/util.js";
import { getTags } from "../../lib/render/tags.js";
import { renderTagBar, getConfiguredTags, TAG_SCRIPT } from "../../lib/render/tags-ui.js";
import { deriveExcerptFromRecord } from "../../lib/excerpt.js";
import { renderBannerRail } from "../../lib/render/banners.js";
import { listPostsPaged, listAllTags, type PostRow } from "../../lib/db/db.js";

type Env = {
  SITE_NAME?: string;
  SITE_URL?: string; // 배포 도메인(절대 URL 만들 때 사용)
  NOTES_TAGS?: string;
  SITE_BANNERS?: string;
  BANNERS_JSON_URL?: string;
  [k: string]: unknown;
};

/** 포스트를 월+연도별로 그룹핑 ("MARCH 2026") — 매 호출 새 DTF 인스턴스는 낭비이므로 모듈 레벨 캐시 */
const MONTH_YEAR_FMT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
function groupByMonth(posts: PostRow[]): Map<string, PostRow[]> {
  const groups = new Map<string, PostRow[]>();
  for (const p of posts) {
    const dateIso = p.published_at || p.updated_at || p.created_at || null;
    const d = dateIso ? new Date(dateIso) : null;
    const key = d ? MONTH_YEAR_FMT.format(d).toUpperCase() : "UNKNOWN";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return groups;
}

export async function renderIndex(env: Env, page: number = 1): Promise<Response> {
  const perPage = 10;

  const [{ items: list, hasNext }, dbTags] = await Promise.all([
    listPostsPaged(Math.max(1, page | 0), perPage),
    listAllTags(),
  ]);
  const tagButtons = dbTags.length ? dbTags : getConfiguredTags(env);

  // 월별 그룹핑
  const monthGroups = groupByMonth(list);

  let itemsHtml = "";
  let first = true;
  for (const [monthLabel, posts] of monthGroups) {
    itemsHtml += `<div class="date${first ? " first-child" : ""}">${escapeHtml(monthLabel)}</div>`;
    first = false;

    for (const r of posts) {
      const slug = (r.slug || "").trim();
      const title = r.title || "(제목 없음)";
      const excerpt = (r.excerpt || deriveExcerptFromRecord(r as any, 160) || "").trim();
      const postTags = getTags(r as any).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
      const dataTags = postTags.join(",");
      const isPaper = postTags.includes("paper");
      const cls = isPaper ? "paper" : "note";

      if (isPaper) {
        itemsHtml += `<a href="/post/${encodeURIComponent(slug)}" class="${cls}" data-tags="${escapeAttr(dataTags)}">
            <h3>${escapeHtml(title)}</h3>
            ${excerpt ? `<p class="description">${escapeHtml(excerpt)}</p>` : ""}
          </a>`;
      } else {
        itemsHtml += `<a href="/post/${encodeURIComponent(slug)}" class="${cls}" data-tags="${escapeAttr(dataTags)}">
            <h3>${escapeHtml(title)}</h3>${excerpt ? `<p class="description">${escapeHtml(excerpt)}</p>` : ""}
          </a>`;
      }
    }
  }

  const pager = `<nav class="pager">
    ${page > 1 ? `<a href="/?page=${page - 1}">&larr; Previous</a>` : ""}
    ${hasNext ? `<a href="/?page=${page + 1}">Next &rarr;</a>` : ""}
  </nav>`;

  const bannerRailHtml = await renderBannerRail({
    SITE_BANNERS: (env as any)?.SITE_BANNERS,
    BANNERS_JSON_URL: (env as any)?.BANNERS_JSON_URL,
    SITE_URL: env.SITE_URL,
  });

  const html = pageHtml(
    {
      showIntro: true,
      headExtra: `<script src="/assets/press.js" defer></script>`,
      body: `
        <h2>Articles</h2>
        ${renderTagBar("all", tagButtons)}
        <div id="post-list" class="toc">${itemsHtml || "<p>No posts yet.</p>"}</div>
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
      "cache-control": "no-store",
    },
  });
}

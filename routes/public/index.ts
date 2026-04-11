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
  let raw = String(env.SITE_URL || (globalThis as any).process?.env?.SITE_URL || "").trim();
  if (raw) {
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    return raw.replace(/\/+$/, "");
  }
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

  // ⬇⬇ 서버 사이드에서만 쓰이는 헤더 — 토큰 있으면 같이 보냄
  const headers: Record<string, string> = { "cache-control": "no-store" };
  const token =
    String((env as any).EDITOR_PASSWORD || (globalThis as any).process?.env?.EDITOR_PASSWORD || "").trim();
  if (token) headers["x-editor-token"] = token;

  const res = await fetch(api, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[index] posts fetch failed:", res.status, body.slice(0, 500));
    throw new Error(`posts fetch failed: ${res.status} — ${body.slice(0, 200)}`);
  }
  const j = await res.json();
  const all: ApiPost[] = Array.isArray(j.list) ? j.list : [];

  const pubSorted = toPublicSorted(all);
  const start = (page - 1) * perPage;
  const pageSlice = pubSorted.slice(start, start + perPage);
  const hasNext = pubSorted.length > start + perPage;

  return { items: pageSlice, hasNext };
}

/** 포스트를 월+연도별로 그룹핑 ("MARCH 2026") */
function groupByMonth(posts: ApiPost[]): Map<string, ApiPost[]> {
  const groups = new Map<string, ApiPost[]>();
  for (const p of posts) {
    const dateIso = p.published_at || p.updated_at || p.created_at || null;
    const d = dateIso ? new Date(dateIso) : null;
    const key = d
      ? d.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase()
      : "UNKNOWN";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return groups;
}

export async function renderIndex(env: Env, page: number = 1): Promise<Response> {
  const perPage = 10;

  const { items: list, hasNext } = await fetchPublicPosts(env, page, perPage);
  const tagButtons = getConfiguredTags(env);

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

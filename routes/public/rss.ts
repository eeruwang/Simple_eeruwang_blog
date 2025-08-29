// src/routes/rss.ts
import { listPosts } from "../../lib/db/db.js";
import { escapeXml } from "../../lib/util.js";
import { deriveExcerptFromRecord } from "../../lib/excerpt.js";

type Env = {
  SITE_URL?: string;
  SITE_NAME?: string;
  SITE_DESC?: string;
};

function stripTrailingSlash(u: string) {
  return u.replace(/\/+$/, "");
}

export async function renderRSS(env: Env): Promise<Response> {
  // 절대 URL 기준 도메인 (끝 슬래시 제거)
  const site = stripTrailingSlash(env.SITE_URL || "https://example.blog");

  // 최신 30개 포스트(페이지 제외)는 listPosts가 이미 필터링함
  const rows = await listPosts(1, 30);

  const items = rows
    .map((r) => {
      const slug = (r.slug || "").trim();
      const title = r.title || slug || "Untitled";
      const when = r.published_at || r.created_at;
      const pubDate = when ? new Date(when).toUTCString() : new Date().toUTCString();

      // 절대 URL
      const link = `${site}/post/${encodeURIComponent(slug)}`;

      const descRaw = r.excerpt || deriveExcerptFromRecord(r as any, 160) || "";
      const desc = escapeXml(descRaw);

      return `  <item>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(link)}</link>
    <guid isPermaLink="true">${escapeXml(link)}</guid>
    <pubDate>${pubDate}</pubDate>
    ${desc ? `<description>${desc}</description>` : ""}
  </item>`;
    })
    .join("\n");

  const channelLink = site;
  const selfLink = `${site}/rss.xml`;
  const feedTitle = env.SITE_NAME || "Feed";
  const feedDesc = env.SITE_DESC || "Posts";

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(feedTitle)}</title>
    <link>${escapeXml(channelLink)}</link>
    <atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(feedDesc)}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: { "content-type": "application/rss+xml; charset=utf-8" },
  });
}

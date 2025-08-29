// src/lib/og.ts
import { escapeHtml, escapeAttr } from "../util.js";

export type EnvLike = {
  SITE_NAME?: string;
  SITE_URL?: string;
  SITE_ORIGIN?: string;   // 있으면 우선 사용
  SITE_OG_IMAGE?: string; // 사이트 대표 OG 이미지(백업)
  SOCIAL_IMAGE?: string;  // 이전 키 호환
};

export type RecordLike = {
  cover_url?: string;
  Cover_url?: string;
  cover?: string;
  Cover?: string;
  excerpt?: string;
  Excerpt?: string;
  description?: string;
  Description?: string;
};

export type OgInput = {
  env: EnvLike;
  title: string;
  description?: string;
  image?: string;          // 상대/절대 모두 허용
  url?: string;            // 상대/절대 모두 허용
  type?: string;           // "website" | "article" | ...
  tags?: Array<string | number>;
  publishedAt?: string | Date | null;
};

/** 절대 URL로 보정 (OG는 절대경로 권장) */
export function absoluteUrl(env: EnvLike, pathOrUrl = ""): string {
  const s = String(pathOrUrl || "");
  // 완전한 절대 또는 프로토콜-상대 URL은 그대로
  if (/^https?:\/\//i.test(s) || s.startsWith("//")) return s;
  const base = String(env.SITE_ORIGIN || env.SITE_URL || "").replace(/\/+$/, "");
  const path = s ? (s.startsWith("/") ? s : "/" + s) : "";
  return base && path ? base + path : s; // base 없으면 개발 중 그대로 노출
}

/** 레코드에서 커버/대표 이미지 고르기 */
export function pickOgImage(env: EnvLike, r?: RecordLike): string {
  const cover = r?.cover_url ?? r?.Cover_url ?? r?.cover ?? r?.Cover;
  const siteFallback = env.SOCIAL_IMAGE || env.SITE_OG_IMAGE || "";
  return cover || siteFallback || "";
}

/** 설명 텍스트(160자 내) */
export function toDescription(r?: RecordLike, fallback = ""): string {
  const raw = r?.excerpt ?? r?.Excerpt ?? r?.description ?? r?.Description ?? fallback;
  return String(raw || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

function toIsoSafe(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** OG + Twitter 카드 메타 묶음 */
export function ogTags({
  env,
  title,
  description = "",
  image = "",
  url = "",
  type = "website",
  tags = [],
  publishedAt,
}: OgInput): string {
  const site = env.SITE_NAME || "Blog";
  const absImg = image ? absoluteUrl(env, image) : "";
  const absUrl = url ? absoluteUrl(env, url) : "";
  const iso = toIsoSafe(publishedAt);

  return `
<meta property="og:site_name" content="${escapeHtml(site)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${absUrl ? `<meta property="og:url" content="${escapeAttr(absUrl)}">` : ""}
${absImg ? `<meta property="og:image" content="${escapeAttr(absImg)}">` : ""}
<meta property="og:type" content="${escapeAttr(type)}">
${iso ? `<meta property="article:published_time" content="${escapeAttr(iso)}">` : ""}
${Array.isArray(tags) ? tags.map(t => `<meta property="article:tag" content="${escapeHtml(String(t))}">`).join("") : ""}
<meta name="twitter:card" content="${absImg ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${absImg ? `<meta name="twitter:image" content="${escapeAttr(absImg)}">` : ""}
`.trim();
}

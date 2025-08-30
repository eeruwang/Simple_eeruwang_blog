// lib/seo.ts
// 안전한 SEO 메타 태그 생성기: siteUrl 스킴 보정, 경로/이미지 안전 조합

type SeoParams = {
  siteUrl: string;          // 사이트 기준 URL (스킴 없이 와도 OK)
  path?: string;            // canonical path (예: "/post/slug" 또는 "post/slug")
  title: string;
  description?: string;
  imageUrl?: string | null; // 절대/상대/프로토콜 상대(//) 모두 허용
  type?: "article" | "website";
};

function normalizeSiteUrl(u: string): string {
  let s = String(u || "").trim();
  if (!s) return "https://example.com";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;  // 스킴 보정
  // 끝 슬래시 제거
  return s.replace(/\/+$/, "");
}

function absUrl(base: string, maybePath: string): string {
  // //example.com/foo 형태 지원
  if (/^\/\//.test(maybePath)) return "https:" + maybePath;
  // http(s) 절대 URL은 그대로
  if (/^https?:\/\//i.test(maybePath)) return maybePath;
  const b = normalizeSiteUrl(base);
  const p = maybePath.startsWith("/") ? maybePath : `/${maybePath}`;
  try {
    return new URL(p, b).toString();
  } catch {
    return `${b}${p}`;
  }
}

function esc(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function seoTags({
  siteUrl,
  path = "/",
  title,
  description = "",
  imageUrl,
  type = "website",
}: SeoParams): string {
  const base = normalizeSiteUrl(siteUrl);

  let canonical = "";
  try {
    const p = path.startsWith("/") ? path : `/${path}`;
    canonical = new URL(p, base).toString();
  } catch {
    canonical = base;
  }

  let ogImage = "";
  if (imageUrl && String(imageUrl).trim()) {
    ogImage = absUrl(base, String(imageUrl));
  }

  // host 파생(에러 없이)
  let host = "";
  try { host = new URL(base).host; } catch { host = base.replace(/^https?:\/\//, ""); }

  const parts = [
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:type" content="${esc(type)}">`,
    `<meta property="og:site_name" content="${esc(host)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    description ? `<meta property="og:description" content="${esc(description)}">` : "",
    `<meta property="og:url" content="${esc(canonical)}">`,
    ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : "",
    `<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    description ? `<meta name="twitter:description" content="${esc(description)}">` : "",
    ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}">` : "",
  ].filter(Boolean);

  return parts.join("\n");
}

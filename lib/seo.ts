// lib/seo.ts
function esc(s = "") { return s.replace(/[<&>"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c] as string)); }

export function seoTags(opts: {
  siteUrl: string;              // 예: https://blog.example.com
  path: string;                 // 예: /post/hello
  title: string;
  description?: string;
  imageUrl?: string;            // 절대/상대 모두 허용
  type?: "website" | "article"; // 기본: path === "/" ? website : article
}) {
  const site = opts.siteUrl.replace(/\/+$/, "");
  const url  = new URL(opts.path || "/", site).toString();
  const type = opts.type || (opts.path === "/" ? "website" : "article");
  const img  = opts.imageUrl ? new URL(opts.imageUrl, site).toString() : null;
  const desc = opts.description || "";

  return `
<link rel="canonical" href="${esc(url)}">
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="${esc(type)}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
${img ? `<meta property="og:image" content="${esc(img)}">` : ""}
<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${esc(opts.title)}">
<meta name="twitter:description" content="${esc(desc)}">
${img ? `<meta name="twitter:image" content="${esc(img)}">` : ""}
`.trim();
}

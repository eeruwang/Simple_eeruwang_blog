// src/lib/render.ts
/* ───────── HTML 프레임 & 첨부파일 유틸 (NocoDB 비의존) ─────────
 * - pageHtml: 공통 <html>/<head>/<body> 레이아웃
 * - resolveAttachmentUrl: 일반화된 파일 객체/경로 → 절대 URL 변환
 * - buildAttachmentIndex: 파일명 → 썸네일/원본 URL 매핑
 */

import { escapeAttr, escapeHtml } from "../util.js";

/* ===== Types ===== */
type EnvLike = {
  SITE_NAME?: string;
  SITE_URL?: string;        // 예: https://example.com
  SITE_ORIGIN?: string;     // 있으면 우선
  ASSET_BASE_URL?: string;  // 예: https://cdn.example.com (없으면 SITE_URL 기준)
};

type FileLike = {
  // 범용 키 (NocoDB 잔형도 일부 호환)
  url?: string;
  signedUrl?: string;
  path?: string;
  raw?: { url?: string; signedUrl?: string; path?: string };
  thumbnails?: Record<string, string | FileLike>;
  title?: string;
  filename?: string;
  name?: string;
};

type Variants = {
  original: string;
  tiny: string | null;
  small: string | null;
  card_cover: string | null;
};

/* ===== Helpers ===== */
function baseOrigin(env: EnvLike): string {
  // 자산 기본 베이스: ASSET_BASE_URL > SITE_ORIGIN > SITE_URL
  return String(env.ASSET_BASE_URL || env.SITE_ORIGIN || env.SITE_URL || "").replace(/\/+$/, "");
}
function isAbs(u?: string): boolean {
  return !!u && (/^https?:\/\//i.test(u) || u.startsWith("//"));
}
function absolutize(env: EnvLike, u?: string): string {
  const s = String(u || "");
  if (!s) return "";
  if (isAbs(s)) return s;
  const base = baseOrigin(env);
  if (!base) return s; // 개발 상황에선 그대로
  const path = s.startsWith("/") ? s : `/${s}`;
  return `${base}${path}`;
}

/* ===== HTML 프레임 ===== */
export function pageHtml(
  { title, body, headExtra = "" }: { title?: string; body: string; headExtra?: string },
  env: EnvLike
): string {
  const year = new Date().getFullYear();
  const siteName = env?.SITE_NAME || "이루왕의 잡동사니";
  const docTitle = title ? `${title} · ${siteName}` : siteName;

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(docTitle)}</title>
  <link rel="alternate" type="application/rss+xml" href="/rss.xml" title="RSS">
  <link rel="stylesheet" href="/assets/style.css">
  ${headExtra}
</head>
<body>
  <header>
    <h1><a href="/">${escapeHtml(siteName)}</a></h1>
    <nav>
      <a href="/about">About</a>
      <a href="/rss.xml">RSS</a>
      <a href="/editor">Editor</a>
    </nav>
  </header>

  <main id="page">
    ${body}
  </main>

  <footer>© ${year} eeruwang. All rights reserved.</footer>

  <!-- 전환 스크립트는 전역에서 한 번만 -->
  <script src="/assets/transition.js" defer></script>
</body>
</html>`;
}

/* ===== 첨부 URL 해석기 + 인덱스 ===== */
/** 범용 파일 객체를 절대 URL로 변환 */
export function resolveAttachmentUrl(env: EnvLike, fileObj?: FileLike | string): string {
  if (!fileObj) return "";
  if (typeof fileObj === "string") return absolutize(env, fileObj);

  const sUrl = fileObj.signedUrl ?? fileObj.raw?.signedUrl;
  const url  = fileObj.url       ?? fileObj.raw?.url;
  const path = fileObj.path      ?? fileObj.raw?.path;

  if (sUrl) return absolutize(env, sUrl);
  if (url)  return absolutize(env, url);
  if (path) return absolutize(env, path);

  return "";
}

export function toFilesArray(v: unknown): FileLike[] {
  if (Array.isArray(v)) return v as FileLike[];
  if (!v) return [];
  if (typeof v === "string") {
    try {
      const arr = JSON.parse(v);
      return Array.isArray(arr) ? (arr as FileLike[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 파일명(확장자/스테밍 포함) → { original, tiny, small, card_cover } */
export function buildAttachmentIndex(
  env: EnvLike,
  r: Record<string, any>,
  fieldName = "file"
): Map<string, Variants> {
  const Alt = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
  const arr = toFilesArray(r?.[fieldName] ?? r?.[Alt]);

  const idx = new Map<string, Variants>();
  if (!Array.isArray(arr)) return idx;

  const norm = (s?: string) => String(s || "").trim().toLowerCase();
  const base = (s?: string) => String(s || "").split("/").pop() || "";
  const stem = (s?: string) => base(s).replace(/\.[^.]+$/, "");

  for (const f of arr) {
    if (!f) continue;

    const original = resolveAttachmentUrl(env, f);
    if (!original) continue;

    // 섬네일 지원: 문자열 또는 FileLike 모두 허용
    const thumbs = f.thumbnails || {};
    const tiny  = thumbs.tiny       ? resolveAttachmentUrl(env, thumbs.tiny as any)       : null;
    const small = thumbs.small      ? resolveAttachmentUrl(env, thumbs.small as any)      : null;
    const card  = thumbs.card_cover ? resolveAttachmentUrl(env, thumbs.card_cover as any) : null;

    const variants: Variants = { original, tiny, small, card_cover: card };

    // 키 후보: title/filename/name/path 와 그들의 base/stem
    const names = [
      f.title, f.filename, f.name, f.path,
      base(f.title), base(f.filename), base(f.name), base(f.path),
    ].filter(Boolean) as string[];

    for (const n of names) {
      const k1 = norm(n);
      const k2 = norm(stem(n));
      if (k1 && !idx.has(k1)) idx.set(k1, variants);
      if (k2 && !idx.has(k2)) idx.set(k2, variants);
    }
  }
  return idx;
}

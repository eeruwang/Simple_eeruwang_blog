// src/lib/banners.ts
import { escapeAttr, escapeHtml } from "../util.js";

export interface BannerItem {
  href: string;
  label: string;
  image?: string;
}

export interface EnvLike {
  SITE_BANNERS?: string;        // JSON 배열 or "href|label|image" 줄/쉼표 구분
  BANNERS_JSON_URL?: string;    // 외부 JSON 경로(절대/상대)
  SITE_URL?: string;            // 상대경로 절대화 기준
}

/** 허용 스킴만 통과 */
const SAFE_SCHEMES = new Set(["http:", "https:"]);

/** 문자열이 제대로 된 URL인지 확인 + http/https 제한 */
function tryAbsUrl(u: string, env: EnvLike): string | null {
  const base = env.SITE_URL || "http://localhost";
  try {
    const abs = new URL(u, base);
    if (!SAFE_SCHEMES.has(abs.protocol)) return null;
    return abs.href;
  } catch {
    return null;
  }
}

/** ENV(SITE_BANNERS) 파싱: JSON 또는 "href|label|image" */
function parseFromEnv(raw: string, env: EnvLike): BannerItem[] {
  if (!raw) return [];
  // 1) JSON
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr
        .map((v) => {
          if (!v || !v.href) return null;
          const href = tryAbsUrl(String(v.href), env);
          if (!href) return null;
          const label = String(v.label || new URL(href).hostname);
          const image = v.image ?? v.img;
          const imgAbs = image ? tryAbsUrl(String(image), env) ?? undefined : undefined;
          return { href, label, image: imgAbs };
        })
        .filter(Boolean) as BannerItem[];
    }
  } catch {
    /* fallthrough */
  }
  // 2) "href|label|image" (쉼표/세미콜론/줄바꿈 구분)
  return String(raw)
    .split(/[,;\n]+/)
    .map((s) => {
      const [hrefRaw, labelRaw, imageRaw] = s.split("|").map((x) => (x ? x.trim() : ""));
      if (!hrefRaw) return null;
      const href = tryAbsUrl(hrefRaw, env);
      if (!href) return null;
      const label = labelRaw || new URL(href).hostname;
      const imgAbs = imageRaw ? tryAbsUrl(imageRaw, env) ?? undefined : undefined;
      return { href, label, image: imgAbs };
    })
    .filter(Boolean) as BannerItem[];
}

/** 외부 JSON에서 로드 (BANNERS_JSON_URL 또는 /assets/banners.json) */
async function loadFromJson(url: string, env: EnvLike): Promise<BannerItem[]> {
  const abs = tryAbsUrl(url, env);
  if (!abs) return [];
  try {
    const r = await fetch(abs, { headers: { accept: "application/json" } });
    if (!r.ok) return [];
    const arr = (await r.json()) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((v: any) => {
        if (!v || !v.href) return null;
        const href = tryAbsUrl(String(v.href), env);
        if (!href) return null;
        const label = String(v.label || new URL(href).hostname);
        const img = v.image ?? v.img;
        const imgAbs = img ? tryAbsUrl(String(img), env) ?? undefined : undefined;
        return { href, label, image: imgAbs };
      })
      .filter(Boolean) as BannerItem[];
  } catch {
    return [];
  }
}

function dedupe(items: BannerItem[]): BannerItem[] {
  const seen = new Set<string>();
  const out: BannerItem[] = [];
  for (const it of items) {
    if (seen.has(it.href)) continue;
    seen.add(it.href);
    out.push(it);
  }
  return out;
}

/** 배너 레일 HTML 생성 (이미지 있으면 <img>, 없으면 텍스트 라벨) */
export async function renderBannerRail(env: EnvLike, max = 12): Promise<string> {
  // 1) ENV 우선
  let items: BannerItem[] = env.SITE_BANNERS ? parseFromEnv(env.SITE_BANNERS, env) : [];

  // 2) 외부 JSON (선택)
  if (!items.length && env.BANNERS_JSON_URL) {
    items = await loadFromJson(env.BANNERS_JSON_URL, env);
  }

  // 3) /assets/banners.json (선택, 라우터가 서빙할 때만)
  if (!items.length) {
    items = await loadFromJson("/assets/banners.json", env);
  }

  items = dedupe(items);
  if (!items.length) return "";

  const list = items.slice(0, Math.max(1, max)).map((b) => {
    const labelHtml = escapeHtml(b.label);
    const hrefAttr = escapeAttr(b.href);
    const content = b.image
      ? `<img src="${escapeAttr(b.image)}" alt="${escapeAttr(b.label)}" loading="lazy" decoding="async">`
      : `<span class="banner-label">${labelHtml}</span>`;
    return `<a class="banner-chip" href="${hrefAttr}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttr(
      b.label
    )}">${content}</a>`;
  }).join("");

  return `<aside class="banner-rail" aria-label="외부 링크 배너">${list}</aside>`;
}

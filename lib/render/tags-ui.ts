// src/lib/tags-ui.ts
/* ───────── 태그 레일 UI ───────── */
import { escapeHtml, escapeAttr } from "../util.js";

/** 필요한 env 키만 */
type EnvLike = { NOTES_TAGS?: string };

/* ───────── 환경변수 → 태그 목록 ───────── */
function parseList(str?: string): string[] {
  return String(str || "")
    .split(/[,\|]/g)
    .map((s: string) => s.trim())
    .filter((s: string) => Boolean(s));
}

export function getConfiguredTags(env?: EnvLike, fallback: string[] = []): string[] {
  const cfg: string[] = parseList(env?.NOTES_TAGS);
  const uniq = <T,>(arr: T[]): T[] => Array.from(new Set(arr));
  return cfg.length ? uniq(cfg) : uniq(fallback);
}

/* ───────── 태그바 HTML ───────── */
export function renderTagBar(activeTag: string = "all", tagList: string[] = []): string {
  const uniqList: string[] = Array.from(new Set(tagList));
  const list: string[] = ["all", ...uniqList];

  const link = (t: string): string => {
    const href: string = t === "all" ? "/" : `/tag/${encodeURIComponent(t)}`;
    const activeAttr: string = t === activeTag ? ' class="is-active"' : "";
    return `<a href="${href}" data-tag="${escapeAttr(t)}"${activeAttr}>${escapeHtml(t)}</a>`;
  };

  return `<nav class="tagrail" id="tagrail">${list.map(link).join("")}</nav>`;
}

export const TAG_SCRIPT: string = ""; // moved to /public/assets/press.js

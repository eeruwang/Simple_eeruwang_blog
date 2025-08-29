// src/lib/tags-data.ts
/* ───────── 태그 유틸 (Postgres 전용) ─────────
 * - normTags: 입력을 정돈된 문자열 배열로
 * - getTags: 레코드에서 태그 배열 뽑기
 * - tagsHtml: 태그 목록을 간단한 HTML로
 *
 * ⚠️ 더 이상 NocoDB의 옵션 자동 추가/재시도 로직은 포함하지 않습니다.
 */

import { escapeHtml } from "../util.js";

/** 문자열/배열/널 등을 깔끔한 태그 배열로 정리 */
export function normTags(v: string | string[] | null | undefined): string[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : String(v).split(",");
  // trim → 빈 값 제거 → 중복 제거
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    const t = String(x).trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** 레코드에서 태그 배열 뽑기 (Postgres text[] 우선) */
export function getTags(r: any): string[] {
  if (!r) return [];
  if (Array.isArray(r.tags)) return r.tags.map(String).map((s: string) => s.trim()).filter(Boolean);
  const t = r.tags ?? r.Tags ?? "";
  return normTags(typeof t === "string" ? t : Array.isArray(t) ? t : []);
}

/** 표시용 HTML (간단한 링크 목록) */
export function tagsHtml(r: any): string {
  const tags = getTags(r);
  if (!tags.length) return "";
  return (
    `<div class="tags">` +
    tags
      .map(
        (t) =>
          `<a class="tag" href="/tag/${encodeURIComponent(t)}">${escapeHtml(t)}</a>`
      )
      .join("") +
    `</div>`
  );
}

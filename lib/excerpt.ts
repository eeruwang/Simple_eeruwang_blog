// src/lib/excerpt.ts
/* ───────── 본문 요약 생성 ─────────
 * - 코드블록, 이미지, 링크 등 불필요한 마크업 제거
 * - 지정 길이까지만 잘라내고 … 추가 (단어 경계 우선)
 */

export type ExcerptSource = {
  body_md?: string;  // snake_case
  bodyMd?: string;   // camelCase
  body?: string;     // generic
  // 과거 호환(대문자 키)
  Body_md?: string;
  Body?: string;
};

export function deriveExcerptFromRecord(r: ExcerptSource, maxLen = 160): string {
  const rawMd =
    r?.body_md ??
    r?.bodyMd ??
    r?.body ??
    (r as any)?.Body_md ??
    (r as any)?.Body ??
    "";

  let s = String(rawMd);

  // 코드/이미지/커스텀 토큰 제거
  s = s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/!\[\[[^\]]+]]/g, " ")
    .replace(/\[\[[^\]]+]]/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 풋노트 제거
  s = s
    .replace(/^\[\^[^\]]+\]:[ \t]+[\s\S]*?(?=(\n\[\^[^\]]+\]:)|\n{2,}|\s*$)/gm, " ")
    .replace(/\[\^[^\]]+\]/g, " ")
    .replace(/\^\[[\s\S]*?\]/g, " ")
    .replace(/\[\^([^:\]]+):[^\]]+\]/g, " ");

  // 마크다운/HTML 기호류 제거
  s = s
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s+/gm, "")
    .replace(/^\s*[-+*]\s+/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/[*_]/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return "";

  // 길이 클램프 + 단어 경계 우선 말줄임
  const take =
    Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 160;

  if (s.length <= take) return s;

  const cut = s.slice(0, take);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace > Math.floor(take * 0.6) ? cut.slice(0, lastSpace) : cut;

  return safe.trim() + "…";
}

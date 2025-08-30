// lib/slug.ts
// 한글 + ASCII 영숫자 + 공백/하이픈/언더스코어만 허용
// 공백→하이픈, 중복 하이픈 정리, 앞뒤 하이픈 제거, NFC 정규화
export function normalizeSlug(raw: string, fallback = "post"): string {
  const s = String(raw || "").normalize("NFC");

  // ASCII만 소문자화 (한글에는 영향 없음)
  let lowered = s.replace(/[A-Z]/g, (c) => c.toLowerCase());

  // 허용 문자만 남기기: 한글 스크립트 + a-z0-9 + 공백/_/-
  // Node 20+에서 유니코드 속성 이스케이프(\p{Script=Hangul}) 지원
  lowered = lowered.replace(/[^\p{Script=Hangul}a-z0-9 _-]+/gu, "");

  // 공백→하이픈, 연속 하이픈 축약, 양끝 하이픈 제거
  const slug = lowered
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

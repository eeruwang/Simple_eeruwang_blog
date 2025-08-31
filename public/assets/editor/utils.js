// utils.js
export const $ = (s) => document.querySelector(s);

export function debounce(fn, ms = 300) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

export function setHint(msg, ms) {
  const el = $("#hint");
  if (!el) return;
  el.textContent = msg || "";
  if (msg && ms) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, ms);
}

export function formatDateTime(isoLike) {
  if (!isoLike) return "";
  const dt = new Date(isoLike); if (isNaN(dt.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

// 한글 보존 slug (서버와 동일 규칙 권장)
export function slugify(s) {
  const t = String(s || "").trim()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}가-힣]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return t || "post";
}

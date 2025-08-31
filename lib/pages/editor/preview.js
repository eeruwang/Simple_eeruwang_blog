// lib/pages/editor/preview.js
// 에디터 프리뷰/TOC/미니맵/링크체커 + 읽기통계
import { debounce } from "./utils.js";

/* ───────── 공통 ───────── */
function $(sel) { return document.querySelector(sel); }
function getPreviewFrame() { return document.getElementById("previewFrame"); }
function getToken() {
  try {
    if (window.EDITOR_KEY) return String(window.EDITOR_KEY);
    const s = sessionStorage.getItem("editor_key");
    if (s) return s;
  } catch {}
  return "";
}

/* ───────── 프리뷰(iframe) ───────── */
function ensurePreviewShell() {
  const iframe = getPreviewFrame();
  if (!iframe || iframe.dataset.ready) return;

  const doc = iframe.contentDocument;
  doc.open();
  // 스켈레톤만 쓴다. 스크립트 로드는 별도 함수에서 동적 주입(CSP 안전)
  doc.write(`<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="/assets/style.css">
<div id="content" style="padding:14px"></div>`);
  doc.close();

  iframe.dataset.ready = "1";
}

function loadMarkedInIframe() {
  const iframe = getPreviewFrame();
  const doc = iframe?.contentDocument;
  if (!doc) return Promise.resolve(false);

  // 이미 로드됨?
  if (doc.defaultView && doc.defaultView.marked) {
    try { doc.defaultView.marked.setOptions({ mangle:false, headerIds:false }); } catch {}
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const s = doc.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
    s.async = true;
    s.onload = () => {
      try { doc.defaultView.marked && doc.defaultView.marked.setOptions({ mangle:false, headerIds:false }); } catch {}
      resolve(!!(doc.defaultView && doc.defaultView.marked));
    };
    s.onerror = () => resolve(false);
    doc.head.appendChild(s);
  });
}

export async function updatePreview(mde) {
  ensurePreviewShell();
  const iframe = getPreviewFrame();
  const doc = iframe?.contentDocument;
  if (!doc) return;

  const md = (mde && mde.value && mde.value()) || "";

  // 1) 서버 렌더 시도
  try {
    const tok = getToken();
    if (tok) {
      const r = await fetch("/api/posts/preview", {
        method: "POST",
        headers: { "content-type": "application/json", "x-editor-token": tok },
        body: JSON.stringify({ md }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.html != null) {
        doc.getElementById("content").innerHTML = j.html || "";
        return;
      }
    }
  } catch {
    /* ignore → fallback */
  }

  // 2) 실패 시 클라 렌더(fallback)
  const ok = await loadMarkedInIframe();
  const html = ok && doc.defaultView.marked ? doc.defaultView.marked.parse(md) : md;
  doc.getElementById("content").innerHTML = html;
}

export const updatePreviewDeb = debounce((mde) => updatePreview(mde), 250);

export function togglePreview(mde) {
  const split = document.querySelector(".editor-split");
  const pane = document.getElementById("previewPane");
  const btn = document.getElementById("previewToggleBtn");

  const on = !!(split && split.classList.toggle("show-preview"));
  if (pane) pane.hidden = !on;
  if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
  if (on) updatePreview(mde);
}

/* ───────── TOC(문서 개요) ───────── */
export function buildTOC(mde) {
  const toc = document.querySelector(".toc-panel");
  if (!toc) return;
  const md = (mde && mde.value && mde.value()) || "";
  const heads = [...md.matchAll(/^#{1,3}\s+(.+)$/gm)] // H1~H3
    .map((m) => ({
      level: (m[0].match(/^#+/) || [""])[0].length,
      text: m[1],
      idx: m.index ?? 0,
    }));
  toc.innerHTML = heads
    .map(
      (h) =>
        `<a data-idx="${h.idx}" style="display:block;padding:4px 8px; padding-left:${(h.level - 1) * 10}px">${h.text}</a>`
    )
    .join("");
}
export const buildTOCDeb = debounce(buildTOC, 250);

export function wireTOCClicks(mde) {
  const toc = document.querySelector(".toc-panel");
  if (!toc || !mde) return;
  toc.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[data-idx]");
    if (!a) return;
    const pos = Number(a.dataset.idx) || 0;
    const cm = mde.codemirror;
    const doc = cm.getDoc();
    const where = doc.posFromIndex(pos);
    cm.focus();
    doc.setCursor(where);
    cm.scrollIntoView(where, 80);
  });
}

/* ───────── 미니맵 ───────── */
export function updateMiniMap(mde) {
  const minimap = document.getElementById("miniMap");
  if (!minimap) return;
  const md = (mde && mde.value && mde.value()) || "";
  const heads = [...md.matchAll(/^#{1,3}\s/gm)].map((m) => m.index || 0);
  minimap.innerHTML = "";
  const total = Math.max(1, md.length);
  heads.forEach((i) => {
    const y = (i / total) * 100;
    const dot = document.createElement("div");
    dot.style.position = "absolute";
    dot.style.left = "2px";
    dot.style.top = `calc(${y}% - 2px)`;
    dot.style.width = "6px";
    dot.style.height = "6px";
    dot.style.borderRadius = "50%";
    dot.style.background = "#aaa";
    minimap.appendChild(dot);
  });
}
export const updateMiniMapDeb = debounce(updateMiniMap, 300);

/* ───────── 링크/이미지 간단 체커 ───────── */
export const checkLinksDeb = debounce(async (mde) => {
  const md = (mde && mde.value && mde.value()) || "";
  const links = [...md.matchAll(/\[([^\]]+)\]\(([^)]+)\)|!\[[^\]]*\]\(([^)]+)\)/g)]
    .map((m) => m[2] || m[3])
    .filter(Boolean);
  const same = links.filter((u) => {
    try {
      const url = new URL(u, location.href);
      return url.origin === location.origin;
    } catch {
      return false;
    }
  });
  // 최대 20개만 체크
  const results = await Promise.all(
    same.slice(0, 20).map(async (u) => {
      try {
        const r = await fetch(u, { method: "HEAD" });
        return { u, ok: r.ok };
      } catch {
        return { u, ok: false };
      }
    })
  );
  const bad = results.filter((x) => !x.ok).map((x) => x.u);
  const saveState = document.getElementById("saveState");
  if (bad.length && saveState) saveState.textContent = `깨진 링크 ${bad.length}개`;
}, 2000);

/* ───────── 읽기 통계 ───────── */
export function readingStatFrom(text) {
  const t = String(text || "");
  const words = (t.match(/\S+/g) || []).length;
  const minutes = Math.max(1, Math.round(words / 250));
  return `${t.length}자 · ${minutes}분`;
}

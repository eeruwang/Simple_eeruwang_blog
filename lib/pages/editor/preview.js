// preview.js
import { el, state, wantsPublished } from "./state.js";
import { apiSend } from "./api.js";
import { debounce } from "./utils.js";

export async function updatePreview(mde) {
  if (!el.previewFrame) return;
  const md = mde ? mde.value() : "";
  try {
    const j = await apiSend("/api/posts/preview", "POST", { md });
    const html = j?.html ? j.html : "<p>(preview failed)</p>";
    el.previewFrame.srcdoc = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/assets/style.css"><article class="post">${html}</article>`;
  } catch (e) {
    el.previewFrame.srcdoc = `<div class="preview-error">미리보기 실패: ${e?.message || e}</div>`;
  }
}
export const updatePreviewDeb = debounce(updatePreview, 250);

export function togglePreview(mde) {
  if (!el.previewPane || !el.previewBtn) return;
  const on = el.previewPane.hasAttribute("hidden");
  if (on) { el.previewPane.removeAttribute("hidden"); el.previewBtn.setAttribute("aria-pressed", "true"); updatePreview(mde); }
  else { el.previewPane.setAttribute("hidden", ""); el.previewBtn.setAttribute("aria-pressed", "false"); }
}

export function buildTOC(mde) {
  const toc = el.toc; if (!toc) return;
  const md = mde?.value() || "";
  const heads = [...md.matchAll(/^#{1,3}\s+(.+)$/gm)].map(m => ({ level: (m[0].match(/^#+/)||[''])[0].length, text: m[1], idx: m.index }));
  toc.innerHTML = heads.map(h => `<a data-idx="${h.idx}" style="padding-left:${(h.level-1)*10}px">${h.text}</a>`).join("");
}
export const buildTOCDeb = debounce(buildTOC, 250);

export function wireTOCClicks(mde) {
  el.toc?.addEventListener("click", e=>{
    const a = e.target.closest('a[data-idx]'); if(!a) return;
    const pos = Number(a.dataset.idx)||0;
    const cm = mde.codemirror;
    const doc = cm.getDoc();
    const where = doc.posFromIndex(pos);
    cm.focus(); doc.setCursor(where); cm.scrollIntoView(where, 80);
  });
}

export function updateMiniMap(mde) {
  const minimap = el.minimap; if (!minimap) return;
  const md = mde?.value() || "";
  const heads = [...md.matchAll(/^#{1,3}\s/gm)].map(m => m.index || 0);
  minimap.innerHTML = "";
  heads.forEach(i=>{
    const y = (i/Math.max(1, md.length)) * 100;
    const dot = document.createElement('div');
    dot.style.position='absolute'; dot.style.left='2px';
    dot.style.top = `calc(${y}% - 2px)`; dot.style.width='6px'; dot.style.height='6px';
    dot.style.borderRadius='50%'; dot.style.background='#aaa';
    minimap.appendChild(dot);
  });
}
export const updateMiniMapDeb = debounce(updateMiniMap, 300);

export async function checkLinks(mde) {
  const md = mde?.value() || '';
  const links = [...md.matchAll(/\[([^\]]+)\]\(([^)]+)\)|!\[[^\]]*\]\(([^)]+)\)/g)]
    .map(m => m[2] || m[3]).filter(Boolean);
  const same = links.filter(u => { try { const url = new URL(u, location.href); return url.origin === location.origin; } catch { return false; }});
  const results = await Promise.all(same.slice(0,20).map(async u=>{
    try { const r = await fetch(u, { method:'HEAD' }); return {u, ok:r.ok}; } catch { return {u, ok:false}; }
  }));
  const bad = results.filter(x=>!x.ok).map(x=>x.u);
  const saveState = document.getElementById("saveState");
  if (bad.length && saveState) saveState.textContent = `깨진 링크 ${bad.length}개`;
}
export const checkLinksDeb = debounce(checkLinks, 2000);

export function readingStatFrom(text){
  const chars = text.length;
  const words = (text.match(/\S+/g)||[]).length;
  const minutes = Math.max(1, Math.round(words/250));
  return `${chars}자 · ${minutes}분`;
}

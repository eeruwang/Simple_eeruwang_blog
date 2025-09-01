// lib/pages/editor/app.js (entry)
import { wireLoginUI } from "/assets/editor/auth.js";
import { setHint, debounce, slugify } from "./utils.js";
import { apiSend, apiGet, asItem } from "./api.js";
import { ensureEditor } from "./mde.js";
import { el, state, wantsPublished, getPublishAtFromInputs, readForm, useRecord, updatePermalink, selectRowInList } from "./state.js";
import { bindListControls, loadList, rebuildFiltered } from "./list.js";
import { bindImageUpload, bindBibtexUpload } from "./uploads.js";
import { updatePreview, updatePreviewDeb, togglePreview, buildTOC, buildTOCDeb, wireTOCClicks, updateMiniMap, updateMiniMapDeb, checkLinksDeb, readingStatFrom } from "./preview.js";

async function actionApply(mde) {
  const data = readForm(mde);
  const wantPub = data.published;
  const payload = { ...data };

  if (state.id) {
    if (wantPub) {
      const at = getPublishAtFromInputs();
      if (at !== null) payload.published_at = at; else delete payload.published_at;
    } else {
      payload.published_at = null;
    }
    await apiSend("/api/posts/" + state.id, "PUT", payload);
    setHint(wantPub ? "발행 적용 완료" : "초안으로 저장 완료", 2000);
    await loadList();
    const full = await apiGet("/api/posts/" + state.id);
    useRecord(asItem(full), mde);
  } else {
    if (wantPub) {
      const at = getPublishAtFromInputs();
      if (at !== null) payload.published_at = at; else delete payload.published_at;
    } else {
      payload.published_at = null;
    }
    const j = await apiSend("/api/posts", "POST", payload);
    setHint(wantPub ? "발행 완료" : "초안 생성 완료", 2000);
    await loadList();
    const created = asItem(j);
    if (created?.id) {
      const full = await apiGet("/api/posts/" + created.id);
      useRecord(asItem(full), mde);
    }
  }
}

function responsiveSide() {
  const mq = window.matchMedia("(max-width: 900px)");
  const isM = () => mq.matches;
  function setMobileOpen(on) { document.body.classList.toggle("side-open", !!on); }
  function syncOnLoad() { if (isM()) document.body.classList.remove("side-collapsed"); setMobileOpen(false); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncOnLoad); else syncOnLoad();
  el.sideToggle?.addEventListener("click", () => { if (isM()) setMobileOpen(!document.body.classList.contains("side-open")); else document.body.classList.toggle("side-collapsed"); });
  mq.addEventListener?.("change", () => { if (isM()) { document.body.classList.remove("side-collapsed"); setMobileOpen(false); } else setMobileOpen(false); });
  el.sideBackdrop?.addEventListener("click", () => setMobileOpen(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMobileOpen(false); });
}

export async function initEditor() {
  if (window.__EDITOR_BOOTED) { console.warn("[editor] init skipped (already booted)"); return; }
  window.__EDITOR_BOOTED = true;
  wireLoginUI();
  responsiveSide();

  const mde = await ensureEditor();
  bindImageUpload(mde);
  bindBibtexUpload();
  bindListControls();
  wireTOCClicks(mde);

  // 버튼/폼
  el.btnNew && el.btnNew.addEventListener("click", (e)=>{ e.preventDefault();
    useRecord({ id:null, title:"", slug:"", tags:[], excerpt:"", is_page:false, published:false, body_md:"" }, mde);
    setHint("새 글");
  });
  el.btnSave && el.btnSave.addEventListener("click", (e)=>{ e.preventDefault();
    actionApply(mde).catch(err => { console.error(err); setHint("저장 실패: " + (err?.message || err)); });
  });
  el.btnDelete && el.btnDelete.addEventListener("click", async (e)=>{ e.preventDefault();
    if (!state.id) { setHint("삭제할 항목이 없습니다.", 2000); return; }
    if (!confirm("정말 삭제할까요?")) return;
    await apiSend("/api/posts/" + state.id, "DELETE");
    setHint("삭제 완료", 2000);
    await loadList();
    useRecord({ id:null, title:"", slug:"", tags:[], excerpt:"", is_page:false, published:false, body_md:"" }, mde);
  });
  el.previewBtn && el.previewBtn.addEventListener("click", (e)=>{ e.preventDefault(); togglePreview(mde); });

  el.title && el.title.addEventListener("input", () => {
    if (!state.id) { const s = slugify(el.title.value); el.slug && (el.slug.value = s); updatePermalink(s); }
    if (mde && el.readingStats) el.readingStats.textContent = readingStatFrom(mde.value()||"");
  });
  el.slug && el.slug.addEventListener("input", () => updatePermalink(el.slug.value));
  el.isPage && el.isPage.addEventListener("change", () => { const s = el.slug ? el.slug.value : (state.slug || ""); updatePermalink(s); });
  el.publishedToggle && el.publishedToggle.addEventListener("change", () => { el.status && (el.status.textContent = wantsPublished() ? "published" : "draft"); });

  // 본문 변경 → 자동저장/읽기통계/프리뷰/TOC/미니맵/링크체커
  let _saveTimer;
  const scheduleAutosave = () => { clearTimeout(_saveTimer); _saveTimer = setTimeout(() => { el.btnSave?.click(); }, 2200); };
  mde?.codemirror.on("change", () => {
    scheduleAutosave();
    if (el.readingStats) el.readingStats.textContent = readingStatFrom(mde.value()||"");
    updatePreviewDeb(mde);
    buildTOCDeb(mde);
    updateMiniMapDeb(mde);
    checkLinksDeb(mde);
  });
  // 그 외 필드도 자동저장
  el.excerpt?.addEventListener("input", scheduleAutosave);
  el.tags?.addEventListener("input", scheduleAutosave);
  el.pubdate?.addEventListener("input", scheduleAutosave);
  el.pubtime?.addEventListener("input", scheduleAutosave);
  el.isPage?.addEventListener("change", scheduleAutosave);

  // Ctrl/Cmd+S → 저장
  window.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); el.btnSave?.click(); } });

  // 리스트 초기화 + 빈 레코드
  await loadList();
  useRecord({ id:null, title:"", slug:"", tags:[], excerpt:"", is_page:false, published:false, body_md:"" }, mde);
  setHint("에디터 준비됨", 1200);

  // 외부에서 상세 열기 지원
  window.__openById = (rec) => {
    useRecord(rec, mde);
    updatePreviewDeb(mde);
    buildTOCDeb(mde);
    updateMiniMapDeb(mde);
  };
}

// 자동 부트스트랩
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => { initEditor().catch(console.error); });
} else {
  initEditor().catch(console.error);
}

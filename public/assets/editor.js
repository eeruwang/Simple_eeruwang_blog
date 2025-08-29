/* public/assets/editor.js
   ESM 모듈. export async function initEditor() 제공.
   - EasyMDE가 없으면 기본 textarea 그대로 사용(폴백)
*/

export async function initEditor() {
  const $ = (s) => document.querySelector(s);

  // ---------- 상태 ----------
  let state = { id: null, slug: "", is_page: false, published: false };

  // ---------- Token / API ----------
  function getToken() {
    try {
      const t1 = localStorage.getItem("editor_token"); if (t1) return t1;
      const t2 = localStorage.getItem("x-editor-token"); if (t2) return t2;
    } catch {}
    const m = document.cookie.match(/(?:^|;\\s*)editor_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  function authHeaders(h = {}) {
    const tok = getToken();
    return tok ? { ...h, "x-editor-token": tok } : h;
  }
  async function apiGet(url) {
    const r = await fetch(url, { headers: authHeaders() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText || `GET ${url} failed`);
    return j;
  }
  async function apiSend(url, method, body) {
    const r = await fetch(url, {
      method,
      headers: authHeaders({ "content-type": "application/json" }),
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText || `${method} ${url} failed`);
    return j;
  }

  // ---------- DOM ----------
  const el = {
    list: $("#postVirtualList"),
    search: $("#searchInput"),
    filter: $("#filterSelect"),
    title: $("#title"),
    slug: $("#slug"),
    tags: $("#tags"),
    excerpt: $("#excerpt"),
    isPage: $("#is_page"),
    pubdate: $("#pubdate"),
    pubtime: $("#pubtime"),
    publishedToggle: $("#publishedToggle"),
    permalink: $("#permalink"),
    status: $("#status"),
    previewBtn: $("#previewToggleBtn"),
    previewPane: $("#previewPane"),
    previewFrame: $("#previewFrame"),
    md: $("#md"),
    btnNew: $("#new"),
    btnSave: $("#save"),
    btnPublish: $("#publish"),
    btnDelete: $("#delete"),
    hint: $("#hint"),
  };

  // ---------- EasyMDE ----------
  let mde = null;
  function ensureEditor() {
    if (mde) return mde;
    if (!window.EasyMDE) {
      console.warn("[editor] EasyMDE not loaded — using textarea fallback");
      return {
        value(v) {
          if (typeof v === "string") el.md.value = v;
          return el.md.value;
        },
        codemirror: { on(){} }
      };
    }
    mde = new window.EasyMDE({
      element: el.md,
      autofocus: false,
      spellChecker: false,
      autosave: { enabled: false },
      status: false,
      minHeight: "300px",
      placeholder: "Write in Markdown…",
    });
    mde.codemirror.on("change", () => { /* 필요시 프리뷰 등 */ });
    return mde;
  }

  // ---------- 헬퍼 ----------
  function setHint(msg, ms = 2500) {
    if (!el.hint) return;
    el.hint.textContent = msg || "";
    if (msg) setTimeout(() => { if (el.hint.textContent === msg) el.hint.textContent = ""; }, ms);
  }
  function slugify(s) {
    const base = String(s || "").trim();
    return (base
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")) || "post";
  }
  function readTagsInput(val) {
    if (Array.isArray(val)) return val.map(String);
    return String(val || "").split(",").map(s => s.trim()).filter(Boolean);
  }
  function updatePermalink(slug) {
    if (el.permalink) el.permalink.textContent = "Permalink: /post/" + encodeURIComponent(slug || "");
  }
  function getPublishAtFromInputs() {
    const d = el.pubdate && el.pubdate.value ? el.pubdate.value : "";
    const t = el.pubtime && el.pubtime.value ? el.pubtime.value : "";
    if (!d && !t) return null;
    return d ? (t ? (d + "T" + t + ":00") : (d + "T00:00:00")) : new Date().toISOString();
  }
  function selectRowInList(id) {
    if (!el.list) return;
    el.list.querySelectorAll(".virtual-row").forEach(x => x.classList.remove("active"));
    const row = el.list.querySelector('.virtual-row[data-id="' + id + '"]');
    if (row) row.classList.add("active");
  }
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }

  function useRecord(rec) {
    state = {
      id: rec && rec.id != null ? rec.id : null,
      slug: rec && rec.slug ? rec.slug : "",
      is_page: !!(rec && rec.is_page),
      published: !!(rec && rec.published),
    };
    if (el.title) el.title.value = (rec && rec.title) || "";
    if (el.slug)  el.slug.value  = (rec && rec.slug) || "";
    if (el.tags)  el.tags.value  = ((rec && rec.tags) || []).join(", ");
    if (el.excerpt) el.excerpt.value = (rec && rec.excerpt) || "";
    if (el.isPage)  el.isPage.checked = !!(rec && rec.is_page);
    if (el.publishedToggle) el.publishedToggle.checked = !!(rec && rec.published);
    if (el.status) el.status.textContent = (rec && rec.published) ? "published" : "draft";
    updatePermalink(rec && rec.slug ? rec.slug : "");

    if (rec && rec.published_at && el.pubdate && el.pubtime) {
      const dt = new Date(rec.published_at);
      const pad = (n) => String(n).padStart(2, "0");
      el.pubdate.value = dt.getFullYear() + "-" + pad(dt.getMonth()+1) + "-" + pad(dt.getDate());
      el.pubtime.value = pad(dt.getHours()) + ":" + pad(dt.getMinutes());
    } else {
      if (el.pubdate) el.pubdate.value = "";
      if (el.pubtime) el.pubtime.value = "";
    }

    ensureEditor().value((rec && rec.body_md) || "");
    selectRowInList(rec && rec.id);
  }

  // ---------- 목록 ----------
  let lastList = [];
  async function loadList() {
    const j = await apiGet("/api/posts?limit=1000&offset=0");
    lastList = Array.isArray(j.list) ? j.list : [];
    renderList();
  }

  function renderList() {
    if (!el.list) return;
    const q = el.search && el.search.value ? el.search.value.toLowerCase() : "";
    const filter = el.filter ? el.filter.value : "all";

    const filtered = lastList.filter((r) => {
      if (filter === "published" && !r.published) return false;
      if (filter === "draft" && r.published) return false;
      if (filter === "page" && !r.is_page) return false;
      if (filter === "post" && r.is_page) return false;
      if (!q) return true;
      const hay = (r.title || "") + " " + ((r.tags || []).join(" "));
      return hay.toLowerCase().includes(q);
    });

    el.list.innerHTML = filtered.map(function(r){
      const dateStr = r.published_at || r.updated_at || r.created_at || "";
      return '<div class="virtual-row" role="option" data-id="'+r.id+'" aria-selected="false" tabindex="0">'
        + '<div class="row" style="gap:8px;align-items:center">'
        +   '<strong style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
        +     escapeHtml(r.title || "(untitled)")
        +   '</strong>'
        +   '<span style="font-size:12px;opacity:.7">'+escapeHtml(r.slug || "")+'</span>'
        + '</div>'
        + '<div class="meta" style="font-size:12px;opacity:.7">'+escapeHtml(dateStr)+'</div>'
        + '</div>';
    }).join("");

    el.list.querySelectorAll(".virtual-row").forEach(function(row){
      row.addEventListener("click", async function(){
        const id = Number(row.getAttribute("data-id") || "0");
        if (!id) return;
        try {
          const rec = await apiGet("/api/posts/" + id);
          useRecord(rec);
        } catch (e) {
          console.error(e);
          setHint("항목 로드 실패");
        }
      });
      row.addEventListener("keydown", function(e){
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.click(); }
      });
    });
  }

  // ---------- 액션 ----------
  function readForm() {
    const title = el.title ? el.title.value : "";
    const slugIn = el.slug ? el.slug.value : "";
    const slug = (slugIn || slugify(title)).trim();
    const tags = readTagsInput(el.tags ? el.tags.value : "");
    const excerpt = el.excerpt ? el.excerpt.value : "";
    const is_page = el.isPage ? !!el.isPage.checked : false;
    const published = el.publishedToggle ? !!el.publishedToggle.checked : false;
    const body_md = ensureEditor().value();
    return { title, slug, tags, excerpt, is_page, published, body_md };
  }

  async function actionNew() {
    useRecord({ id:null, title:"", slug:"", tags:[], excerpt:"", is_page:false, published:false, body_md:"" });
    setHint("새 글");
  }

  async function actionSaveDraft() {
    const data = readForm();
    data.published = false;
    const payload = { ...data, published_at: null };

    let rec;
    if (state.id) {
      rec = await apiSend("/api/posts/" + state.id, "PATCH", payload);
      setHint("임시저장 완료");
    } else {
      const j = await apiSend("/api/posts", "POST", payload);
      rec = j && j.created ? j.created[0] : null;
      setHint("초안 생성 완료");
    }
    await loadList();
    if (rec && rec.id) {
      const full = await apiGet("/api/posts/" + rec.id);
      useRecord(full);
    }
  }

  async function actionPublish() {
    const data = readForm();
    data.published = true;
    const published_at = getPublishAtFromInputs();

    let rec;
    if (state.id) {
      rec = await apiSend("/api/posts/" + state.id, "PATCH", { ...data, published_at });
      setHint("발행 완료");
    } else {
      const j = await apiSend("/api/posts", "POST", { ...data, published_at });
      rec = j && j.created ? j.created[0] : null;
      setHint("발행 완료");
    }
    await loadList();
    if (rec && rec.id) {
      const full = await apiGet("/api/posts/" + rec.id);
      useRecord(full);
    }
  }

  async function actionDelete() {
    if (!state.id) { setHint("삭제할 항목이 없습니다."); return; }
    if (!confirm("정말 삭제할까요?")) return;
    await apiSend("/api/posts/" + state.id, "DELETE");
    setHint("삭제 완료");
    await loadList();
    await actionNew();
  }

  // ---------- 프리뷰 ----------
  async function updatePreview() {
    if (!el.previewFrame) return;
    const md = ensureEditor().value();
    try {
      const j = await apiSend("/api/posts/preview", "POST", { md });
      const html = (j && j.html) ? j.html : "<p>(preview failed)</p>";
      el.previewFrame.srcdoc = '<!doctype html><meta charset="utf-8">'
        + '<link rel="stylesheet" href="/assets/style.css">'
        + '<article class="post">' + html + '</article>';
    } catch (e) {
      el.previewFrame.srcdoc = '<p style="color:#c00">미리보기 실패: ' + escapeHtml(e.message || String(e)) + '</p>';
    }
  }

  function togglePreview() {
    if (!el.previewPane || !el.previewBtn) return;
    const on = el.previewPane.hasAttribute("hidden");
    if (on) {
      el.previewPane.removeAttribute("hidden");
      el.previewBtn.setAttribute("aria-pressed", "true");
      updatePreview();
    } else {
      el.previewPane.setAttribute("hidden", "");
      el.previewBtn.setAttribute("aria-pressed", "false");
    }
  }

  // ---------- 바인딩 ----------
  el.btnNew && el.btnNew.addEventListener("click", function(e){ e.preventDefault(); actionNew().catch(console.error); });
  el.btnSave && el.btnSave.addEventListener("click", function(e){ e.preventDefault(); actionSaveDraft().catch(err => { console.error(err); setHint("저장 실패"); }); });
  el.btnPublish && el.btnPublish.addEventListener("click", function(e){ e.preventDefault(); actionPublish().catch(err => { console.error(err); setHint("발행 실패"); }); });
  el.btnDelete && el.btnDelete.addEventListener("click", function(e){ e.preventDefault(); actionDelete().catch(err => { console.error(err); setHint("삭제 실패"); }); });
  el.previewBtn && el.previewBtn.addEventListener("click", function(e){ e.preventDefault(); togglePreview(); });

  el.title && el.title.addEventListener("input", function(){
    if (!state.id) {
      const s = slugify(el.title.value);
      if (el.slug) el.slug.value = s;
      updatePermalink(s);
    }
  });
  el.slug && el.slug.addEventListener("input", function(){ updatePermalink(el.slug.value); });
  el.publishedToggle && el.publishedToggle.addEventListener("change", function(){
    if (el.status) el.status.textContent = el.publishedToggle.checked ? "published" : "draft";
  });
  el.search && el.search.addEventListener("input", renderList);
  el.filter && el.filter.addEventListener("change", renderList);

  // ---------- 초기 부팅 ----------
  ensureEditor();          // 에디터(또는 폴백) 준비
  await loadList();        // 목록 로드 → 좌측 패널 채우기
  await actionNew();       // 새 글 상태로 시작
  setHint("에디터 준비됨");

  // UI 표시 보조
  document.body.classList.add("editor-ready");
}

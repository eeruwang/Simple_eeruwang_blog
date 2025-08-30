// public/assets/editor.js
export async function initEditor() {
  const $ = (s) => document.querySelector(s);

  function setHint(msg, ms) {
    const el = $("#hint");
    if (!el) return;
    el.textContent = msg || "";
    if (msg && ms) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, ms);
  }

  // EasyMDE 전역 확인 (CDN 로드가 느릴 수 있음)
  async function ensureEasyMDE() {
    let t = 0;
    while (typeof window.EasyMDE !== "function" && t < 50) { // 최대 ~2.5s
      await new Promise(r => setTimeout(r, 50)); t++;
    }
    if (typeof window.EasyMDE !== "function") {
      throw new Error("EasyMDE가 로드되지 않았습니다(CDN 차단/지연).");
    }
  }

  // ----- 토큰/헤더/요청 유틸 -----
  function getToken() {
    try {
      const t1 = localStorage.getItem("editor_token"); if (t1) return t1;
      const t2 = localStorage.getItem("x-editor-token"); if (t2) return t2;
    } catch {}
    const m = document.cookie.match(/(?:^|;\\s*)editor_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  function authHeaders(h) {
    const tok = getToken();
    const base = h && typeof h === "object" ? h : {};
    return tok ? { ...base, "x-editor-token": tok } : base;
  }
  async function apiGet(url) {
    const r = await fetch(url, { headers: authHeaders() });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch {}
    if (!r.ok) throw new Error((j && j.error) || r.statusText || ("GET " + url + " failed"));
    return j;
  }
  async function apiSend(url, method, body) {
    const r = await fetch(url, {
      method,
      headers: authHeaders({ "content-type": "application/json" }),
      body: body ? JSON.stringify(body) : undefined
    });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch {}
    if (!r.ok) throw new Error((j && j.error) || r.statusText || (method + " " + url + " failed"));
    return j;
  }

  // ----- DOM refs -----
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
  };

  // ----- 에디터 -----
  let mde = null;
  async function ensureEditor() {
    await ensureEasyMDE();
    if (mde) return mde;
    if (!el.md) throw new Error("#md textarea not found");
    mde = new window.EasyMDE({
      element: el.md,
      autofocus: false,
      spellChecker: false,
      autosave: { enabled: false },
      status: false,
      minHeight: "300px",
      placeholder: "Write in Markdown…",
      autoDownloadFontAwesome: false
    });
    return mde;
  }

  function slugify(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-") || "post";
  }
  function updatePermalink(slug) {
    if (el.permalink) el.permalink.textContent = "Permalink: /post/" + encodeURIComponent(slug || "");
  }
  function readTagsInput(val) {
    if (Array.isArray(val)) return val.map(String);
    return String(val || "").split(",").map(s => s.trim()).filter(Boolean);
  }
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }

  // ----- 상태 -----
  let state = { id: null, slug: "", is_page: false, published: false };

  function selectRowInList(id) {
    if (!el.list) return;
    el.list.querySelectorAll(".virtual-row").forEach(x => x.classList.remove("active"));
    const row = el.list.querySelector('.virtual-row[data-id="' + id + '"]');
    if (row) row.classList.add("active");
  }

  function useRecord(rec) {
    state = {
      id: rec && rec.id != null ? rec.id : null,
      slug: rec && rec.slug ? rec.slug : "",
      is_page: !!(rec && rec.is_page),
      published: !!(rec && rec.published)
    };
    if (el.title) el.title.value = (rec && rec.title) || "";
    if (el.slug)  el.slug.value  = (rec && rec.slug) || "";
    if (el.tags)  el.tags.value  = ((rec && rec.tags) || []).join(", ");
    if (el.excerpt) el.excerpt.value = (rec && rec.excerpt) || "";
    if (el.isPage)  el.isPage.checked = !!(rec && rec.is_page);
    if (el.publishedToggle) el.publishedToggle.checked = !!(rec && rec.published);
    if (el.status) el.status.textContent = (rec && rec.published) ? "published" : "draft";
    updatePermalink((rec && rec.slug) || "");

    if (rec && rec.published_at && el.pubdate && el.pubtime) {
      const dt = new Date(rec.published_at);
      const pad = (n) => String(n).padStart(2, "0");
      el.pubdate.value = dt.getFullYear() + "-" + pad(dt.getMonth()+1) + "-" + pad(dt.getDate());
      el.pubtime.value = pad(dt.getHours()) + ":" + pad(dt.getMinutes());
    } else {
      if (el.pubdate) el.pubdate.value = "";
      if (el.pubtime) el.pubtime.value = "";
    }

    if (mde) mde.value((rec && rec.body_md) || "");
    selectRowInList(state.id);
  }

  // ----- 목록 -----
  let lastList = [];
  async function loadList() {
    setHint("목록 불러오는 중…");
    try {
      const j = await apiGet("/api/posts?limit=1000&offset=0");
      lastList = Array.isArray(j.list) ? j.list : [];
      renderList();
      setHint(lastList.length ? "" : "글이 없습니다. New로 작성해 보세요.", 3000);
    } catch (e) {
      console.error(e);
      setHint("목록 로드 실패: " + (e && e.message ? e.message : e));
    }
  }

  function renderList() {
    if (!el.list) return;
    const q = (el.search && el.search.value ? el.search.value : "").toLowerCase();
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

    el.list.innerHTML = filtered.map(r => {
      const dateStr = r.published_at || r.updated_at || r.created_at || "";
      return '<div class="virtual-row" role="option" data-id="' + r.id + '" aria-selected="false" tabindex="0">' +
               '<div class="row" style="gap:8px;align-items:center">' +
                 '<strong style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(r.title || "(untitled)") + '</strong>' +
                 '<span style="font-size:12px;opacity:.7">' + escapeHtml(r.slug || "") + '</span>' +
               '</div>' +
               '<div class="meta" style="font-size:12px;opacity:.7">' + escapeHtml(dateStr) + '</div>' +
             '</div>';
    }).join("");

    el.list.querySelectorAll(".virtual-row").forEach((row) => {
      row.addEventListener("click", async () => {
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
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.click(); }
      });
    });
  }

  function getPublishAtFromInputs() {
    const d = (el.pubdate && el.pubdate.value) ? el.pubdate.value : "";
    const t = (el.pubtime && el.pubtime.value) ? el.pubtime.value : "";
    if (!d && !t) return null;
    return d ? (t ? (d + "T" + t + ":00") : (d + "T00:00:00")) : new Date().toISOString();
  }

  function readForm() {
    const title = el.title ? el.title.value : "";
    const slugIn = el.slug ? el.slug.value : "";
    const slug = (slugIn || slugify(title)).trim();
    const tags = readTagsInput(el.tags ? el.tags.value : "");
    const excerpt = el.excerpt ? el.excerpt.value : "";
    const is_page = el.isPage ? !!el.isPage.checked : false;
    const published = el.publishedToggle ? !!el.publishedToggle.checked : false;
    const body_md = mde ? mde.value() : (el.md ? el.md.value : "");
    return { title, slug, tags, excerpt, is_page, published, body_md };
  }

  async function actionNew() {
    useRecord({ id: null, title:"", slug:"", tags:[], excerpt:"", is_page:false, published:false, body_md:"" });
    setHint("새 글");
  }

  async function actionSaveDraft() {
    const data = readForm();
    data.published = false;
    const payload = { ...data, published_at: null };
    let rec;
    if (state.id) {
      rec = await apiSend("/api/posts/" + state.id, "PATCH", payload);
      setHint("임시저장 완료", 2000);
    } else {
      const j = await apiSend("/api/posts", "POST", payload);
      rec = j && j.created ? j.created[0] : null;
      setHint("초안 생성 완료", 2000);
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
      setHint("발행 완료", 2000);
    } else {
      const j = await apiSend("/api/posts", "POST", { ...data, published_at });
      rec = j && j.created ? j.created[0] : null;
      setHint("발행 완료", 2000);
    }
    await loadList();
    if (rec && rec.id) {
      const full = await apiGet("/api/posts/" + rec.id);
      useRecord(full);
    }
  }

  async function actionDelete() {
    if (!state.id) { setHint("삭제할 항목이 없습니다.", 2000); return; }
    if (!confirm("정말 삭제할까요?")) return;
    await apiSend("/api/posts/" + state.id, "DELETE");
    setHint("삭제 완료", 2000);
    await loadList();
    await actionNew();
  }

  async function updatePreview() {
    if (!el.previewFrame) return;
    const md = mde ? mde.value() : "";
    try {
      const j = await apiSend("/api/posts/preview", "POST", { md });
      const html = (j && j.html) ? j.html : "<p>(preview failed)</p>";
      el.previewFrame.srcdoc = `
        <!doctype html><meta charset="utf-8">
        <link rel="stylesheet" href="/assets/style.css">
        <article class="post">${html}</article>`;
    } catch (e) {
      el.previewFrame.srcdoc =
        `<div class="preview-error">미리보기 실패: ${escapeHtml(e.message || String(e))}</div>`;
    }
  }


  function togglePreview() {
    if (!el.previewPane || !el.previewBtn) return;
    const on = el.previewPane.hasAttribute("hidden");
    if (on) {
      el.previewPane.removeAttribute("hidden");
      el.previewBtn.setAttribute("aria-pressed", "true");
      // 서버 렌더 프리뷰
      updatePreview();
    } else {
      el.previewPane.setAttribute("hidden", "");
      el.previewBtn.setAttribute("aria-pressed", "false");
    }
  }

  // ----- 바인딩 -----
  el.btnNew && el.btnNew.addEventListener("click", (e)=>{ e.preventDefault(); actionNew().catch(console.error); });
  el.btnSave && el.btnSave.addEventListener("click", (e)=>{ e.preventDefault(); actionSaveDraft().catch(err => { console.error(err); setHint("저장 실패"); }); });
  el.btnPublish && el.btnPublish.addEventListener("click", (e)=>{ e.preventDefault(); actionPublish().catch(err => { console.error(err); setHint("발행 실패"); }); });
  el.btnDelete && el.btnDelete.addEventListener("click", (e)=>{ e.preventDefault(); actionDelete().catch(err => { console.error(err); setHint("삭제 실패"); }); });
  el.previewBtn && el.previewBtn.addEventListener("click", (e)=>{ e.preventDefault(); togglePreview(); });

  el.title && el.title.addEventListener("input", () => {
    if (!state.id) {
      const s = slugify(el.title.value);
      if (el.slug) el.slug.value = s;
      updatePermalink(s);
    }
  });
  el.slug && el.slug.addEventListener("input", () => updatePermalink(el.slug.value));
  el.publishedToggle && el.publishedToggle.addEventListener("change", () => {
    if (el.status) el.status.textContent = el.publishedToggle.checked ? "published" : "draft";
  });
  el.search && el.search.addEventListener("input", renderList);
  el.filter && el.filter.addEventListener("change", renderList);

  // ----- 부팅 -----
  try {
    await ensureEditor();
  } catch (e) {
    console.error(e);
    setHint(e && e.message ? e.message : "에디터 로드 실패");
  }
  await loadList();
  await actionNew();
  setHint("에디터 준비됨", 1500);
}

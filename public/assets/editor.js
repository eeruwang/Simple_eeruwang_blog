// public/assets/editor.js
// 모듈 스크립트(ESM). 서버는 <script type="module" src="/assets/editor.js" defer> 로 주입합니다.

export async function initEditor() {
  const $ = (s) => document.querySelector(s);

  /* ───────────────── 작은 UI 헬퍼 ───────────────── */
  function setHint(msg, ms) {
    const el = $("#hint");
    if (!el) return;
    el.textContent = msg || "";
    if (msg && ms) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, ms);
  }
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }

  /* ───────────────── EasyMDE 로더 ───────────────── */
  function injectEasyMDEAssets() {
    if (!document.querySelector('link[data-easymde]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/easymde/dist/easymde.min.css";
      link.setAttribute("data-easymde", "1");
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-easymde]')) {
      const scr = document.createElement("script");
      scr.src = "https://unpkg.com/easymde/dist/easymde.min.js";
      scr.defer = true;
      scr.setAttribute("data-easymde", "1");
      document.head.appendChild(scr);
    }
  }
  async function ensureEasyMDE() {
    if (typeof window.EasyMDE === "function") return;
    // 1차: 기존 스크립트 로딩 대기
    let t = 0;
    while (typeof window.EasyMDE !== "function" && t < 100) { await new Promise(r => setTimeout(r, 50)); t++; }
    if (typeof window.EasyMDE === "function") return;
    // 2차: 동적 삽입 후 대기
    injectEasyMDEAssets();
    t = 0;
    while (typeof window.EasyMDE !== "function" && t < 200) { await new Promise(r => setTimeout(r, 50)); t++; }
    if (typeof window.EasyMDE !== "function") throw new Error("EasyMDE가 로드되지 않았습니다.");
  }

  /* ───────────────── 인증 토큰 ───────────────── */
  function getToken() {
    // 여러 키를 모두 지원 (과거 호환)
    try {
      const cand = [
        "EDITOR_TOKEN", "editor_token", "x-editor-token",
        "editorToken", "xEditorToken"
      ];
      for (const k of cand) { const v = localStorage.getItem(k); if (v) return v; }
    } catch {}
    const m = document.cookie.match(/(?:^|;\s*)(editor_token|EDITOR_TOKEN)=([^;]+)/);
    return m ? decodeURIComponent(m[2]) : (
      // 세션 저장소(과거 호환)
      (typeof sessionStorage !== "undefined" && sessionStorage.getItem("editor_key")) || ""
    );
  }
  function setAuthToken(token) {
    try {
      localStorage.setItem("EDITOR_TOKEN", token);
      localStorage.setItem("editor_token", token);
      localStorage.setItem("x-editor-token", token);
      sessionStorage.setItem("editor_key", token);
      document.cookie = `editor_token=${encodeURIComponent(token)}; path=/; SameSite=Lax`;
    } catch {}
    document.body.setAttribute("data-auth", "1");
  }

  /* ───────────────── 로그인 UI(선택) ───────────────── */
  async function wireLoginUI() {
    const btn = document.getElementById("signin");
    const inp = document.getElementById("key");
    const hint = document.getElementById("lock-hint");

    async function tryKey(k) {
      if (!k) return false;
      try {
        const r = await fetch("/api/check-key", { headers: { "x-editor-token": k } });
        if (!r.ok) return false;
        setAuthToken(k);
        return true;
      } catch { return false; }
    }

    // 자동 로그인
    const saved = getToken();
    if (saved) await tryKey(saved);

    if (btn && inp) {
      btn.addEventListener("click", async () => {
        const ok = await tryKey((inp.value || "").trim());
        if (!ok && hint) hint.textContent = "비밀번호가 올바르지 않습니다.";
      });
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });
    }

    document.getElementById("signout")?.addEventListener("click", () => {
      try {
        sessionStorage.removeItem("editor_key");
        localStorage.removeItem("EDITOR_TOKEN");
        localStorage.removeItem("editor_token");
        localStorage.removeItem("x-editor-token");
      } catch {}
      document.body.removeAttribute("data-auth");
      setHint("Signed out", 1500);
    });
  }

  /* ───────────────── API 유틸 ───────────────── */
  function authHeaders(h) {
    const tok = getToken(); const base = h && typeof h === "object" ? h : {};
    return tok ? { ...base, "x-editor-token": tok } : base;
  }
  async function apiGet(url) {
    const sep = url.includes("?") ? "&" : "?";
    const bust = `${sep}ts=${Date.now()}`;
    const r = await fetch(url + bust, { headers: authHeaders(), cache: "no-store" });
    const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch {}
    if (!r.ok) throw new Error((j && j.error) || r.statusText || ("GET " + url + " failed"));
    return j;
  }
  async function apiSend(url, method, body) {
    const r = await fetch(url, {
      method,
      headers: authHeaders({ "content-type": "application/json" }),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch {}
    if (!r.ok) throw new Error((j && j.error) || r.statusText || (method + " " + url + " failed"));
    return j;
  }
  function asItem(resp) {
    if (!resp) return null;
    if (resp.item) return resp.item;
    if (resp.updated) return resp.updated;
    if (resp.created && Array.isArray(resp.created) && resp.created[0]) return resp.created[0];
    return resp;
  }

  /* ───────────────── 슬러그/날짜 헬퍼 ───────────────── */
  // 한글 보존 slug: 영문/숫자/한글 유지, 나머지는 '-' 치환
  function slugify(s) {
    const t = String(s || "").trim()
      .normalize("NFKC")
      .replace(/[^\p{Letter}\p{Number}가-힣]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
    return t || "post";
  }
  function formatDateTime(isoLike) {
    if (!isoLike) return "";
    const dt = new Date(isoLike); if (isNaN(dt.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }
  function getPublishAtFromInputs() {
    const d = el.pubdate?.value || ""; const t = el.pubtime?.value || "";
    if (!d && !t) return null;
    return d ? (t ? `${d}T${t}:00` : `${d}T00:00:00`) : new Date().toISOString();
  }

  /* ───────────────── DOM refs ───────────────── */
  const el = {
    list: $("#postVirtualList"),
    search: $("#searchInput"),
    filter: $("#filterSelect"),
    savedViews: $("#savedViews"),
    saveViewBtn: $("#saveViewBtn"),
    sideToggle: $("#sideToggle"),
    sideBackdrop: $("#sideBackdrop"),

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
    btnDelete: $("#delete"),

    attachBtn: $("#attachBtn"),
    attach: $("#attach"),

    readingStats: $("#readingStats"),
    toc: document.querySelector(".toc-panel"),
    minimap: document.getElementById("miniMap"),
  };

  /* ───────────────── 반응형 사이드패널 토글 ───────────────── */
  (function responsiveSide() {
    const mq = window.matchMedia("(max-width: 900px)");
    const isM = () => mq.matches;
    function setMobileOpen(on) { document.body.classList.toggle("side-open", !!on); }
    function syncOnLoad() {
      if (isM()) document.body.classList.remove("side-collapsed");
      setMobileOpen(false);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncOnLoad);
    else syncOnLoad();

    el.sideToggle?.addEventListener("click", () => {
      if (isM()) setMobileOpen(!document.body.classList.contains("side-open"));
      else document.body.classList.toggle("side-collapsed");
    });
    mq.addEventListener?.("change", () => { if (isM()) { document.body.classList.remove("side-collapsed"); setMobileOpen(false); } else setMobileOpen(false); });
    el.sideBackdrop?.addEventListener("click", () => setMobileOpen(false));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMobileOpen(false); });
  })();

  /* ───────────────── EasyMDE 인스턴스 ───────────────── */
  let mde = null;
  async function ensureEditor() {
    await ensureEasyMDE();
    if (mde) return mde;
    if (!el.md) throw new Error("#md textarea not found");
    const toolbar = [
      "bold","italic","heading","|","quote","unordered-list","ordered-list","|",
      "link",
      { name: "image-upload", action: () => el.attach && el.attach.click(), className: "fa fa-picture-o", title: "Insert image (upload)" },
      "|","preview","side-by-side","fullscreen","guide"
    ];
    mde = new window.EasyMDE({
      element: el.md,
      autofocus: false,
      spellChecker: false,
      autosave: { enabled: false }, // 자동저장은 아래 커스텀으로
      status: false,
      minHeight: "300px",
      placeholder: "Write in Markdown…",
      autoDownloadFontAwesome: false,
      toolbar,
    });
    return mde;
  }

  /* ───────────────── 상태 & 폼 ───────────────── */
  let state = { id: null, slug: "", is_page: false, published: false };
  const wantsPublished = () => (el.publishedToggle ? !!el.publishedToggle.checked : false);

  // 퍼머링크: 텍스트는 한글 그대로, href는 encodeURIComponent 적용
  function computePermalink(slug) {
    const isPage = el.isPage ? !!el.isPage.checked : !!state.is_page;
    const base = isPage ? "/" : "/post/";
    const s = String(slug || "").trim();
    return { pretty: base + (s || ""), href: base + encodeURIComponent(s || "") };
  }
  function updatePermalink(slug) {
    if (!el.permalink) return;
    const { pretty, href } = computePermalink(slug);
    if (el.permalink.tagName === "A") {
      el.permalink.setAttribute("href", href);
      el.permalink.textContent = "Permalink: " + pretty;
      el.permalink.setAttribute("data-href-encoded", href);
    } else {
      const a = el.permalink.querySelector?.("a");
      if (a) { a.setAttribute("href", href); a.textContent = pretty; }
      el.permalink.textContent = "Permalink: " + pretty;
    }
  }
  function readTagsInput(val) {
    if (Array.isArray(val)) return val.map(String);
    return String(val || "").split(",").map(s => s.trim()).filter(Boolean);
  }
  function readForm() {
    const title = el.title?.value || "";
    const slugIn = el.slug?.value || "";
    const slug = (slugIn || slugify(title)).trim();
    const tags = readTagsInput(el.tags?.value || "");
    const excerpt = el.excerpt?.value || "";
    const is_page = el.isPage ? !!el.isPage.checked : false;
    const published = wantsPublished();
    const body_md = mde ? mde.value() : (el.md ? el.md.value : "");
    return { title, slug, tags, excerpt, is_page, published, body_md };
  }
  function useRecord(rec) {
    if (!rec) return;
    state = {
      id: rec?.id ?? null,
      slug: rec?.slug || "",
      is_page: !!rec?.is_page,
      published: !!rec?.published
    };
    el.title && (el.title.value = rec?.title || "");
    el.slug && (el.slug.value = rec?.slug || "");
    el.tags && (el.tags.value = Array.isArray(rec?.tags) ? rec.tags.join(", ") : (rec?.tags || ""));
    el.excerpt && (el.excerpt.value = rec?.excerpt || "");
    el.isPage && (el.isPage.checked = !!rec?.is_page);
    el.publishedToggle && (el.publishedToggle.checked = !!rec?.published);
    el.status && (el.status.textContent = rec?.published ? "published" : "draft");
    updatePermalink(rec?.slug || "");

    if (rec?.published_at && el.pubdate && el.pubtime) {
      const dt = new Date(rec.published_at); const pad = (n) => String(n).padStart(2, "0");
      el.pubdate.value = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
      el.pubtime.value = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    } else {
      el.pubdate && (el.pubdate.value = ""); el.pubtime && (el.pubtime.value = "");
    }

    mde && mde.value(rec?.body_md || "");
    selectRowInList(state.id);
  }

  /* ───────────────── 목록/가상 스크롤/검색 저장 ───────────────── */
  let lastList = [];      // 서버에서 받은 전체
  let filtered = [];      // 필터/검색 적용 결과
  let rowH = 120;         // 가상 리스트 예상 높이(px)

  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  function matches(r) {
    const q = (el.search?.value || "").toLowerCase();
    const filter = el.filter ? el.filter.value : "all";
    if (filter === "published" && !r.published) return false;
    if (filter === "draft" && r.published) return false;
    if (filter === "page" && !r.is_page) return false;
    if (filter === "post" && r.is_page) return false;
    if (!q) return true;
    const hay = (r.title || "") + " " + ((r.tags || []).join(" "));
    return hay.toLowerCase().includes(q);
  }
  function rebuildFiltered() {
    filtered = lastList.filter(matches);
    if (el.list) { el.list.scrollTop = 0; renderVirtual(); }
  }
  function renderVirtual() {
    if (!el.list) return;
    const vh = el.list.clientHeight || 400;
    const total = filtered.length;
    const scrollTop = el.list.scrollTop;
    const start = Math.max(0, Math.floor(scrollTop / rowH) - 5);
    const end = Math.min(total, start + Math.ceil(vh / rowH) + 10);
    const padTop = start * rowH;
    const padBot = (total - end) * rowH;
    const slice = filtered.slice(start, end);

    el.list.innerHTML = `
      <div style="height:${padTop}px"></div>
      ${slice.map(r => {
        const id = r.id || "";
        const title = r.title || "(untitled)";
        const dateStr = formatDateTime(r.published_at || r.updated_at || r.created_at);
        const status = r.is_page ? "page" : (r.published ? "published" : "draft");
        const badgeStyle = r.is_page
          ? "background:#eef6ff;color:#084298"
          : (r.published ? "background:#e6f4ea;color:#0f5132" : "background:#fdecef;color:#842029");
        const tagsArr = Array.isArray(r.tags)
          ? r.tags
          : (r.tags ? String(r.tags).split(",").map(s=>s.trim()).filter(Boolean) : []);
        const tagsHtml = tagsArr.map(t => `<span class="tag" style="font-size:11px;padding:2px 6px;border-radius:6px;background:#f1f5f9">${escapeHtml(t)}</span>`).join("");
        const slugText = r.slug ? `/${escapeHtml(r.is_page ? r.slug : "post/"+r.slug)}` : "";

        return `
          <div class="virtual-row" role="option" data-id="${id}" aria-selected="false" tabindex="0" style="padding:8px 10px;border-bottom:1px solid #eef2f7;height:${rowH-1}px;box-sizing:border-box;">
            <div class="title-line" style="font-weight:600;line-height:1.35;margin:0 0 4px 0;white-space:normal;word-break:break-word;">
              ${escapeHtml(title)}
            </div>
            <div class="meta-line" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;opacity:.85;">
              <span class="badge" style="padding:2px 8px;border-radius:999px;${badgeStyle}">${status}</span>
              ${slugText ? `<span class="slug" style="opacity:.8">${slugText}</span>` : ""}
              <span class="date" style="opacity:.7">${escapeHtml(dateStr)}</span>
            </div>
            ${tagsArr.length ? `<div class="tags-line" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">${tagsHtml}</div>` : ""}
          </div>
        `;
      }).join("")}
      <div style="height:${padBot}px"></div>
    `;

    // 항목 클릭/키보드 열기
    el.list.querySelectorAll(".virtual-row").forEach((row) => {
      row.addEventListener("click", async () => {
        const id = Number(row.getAttribute("data-id") || "0");
        if (!id) return;
        await openById(id);
      });
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.click(); }
      });
    });
  }
  function selectRowInList(id) {
    if (!el.list) return;
    el.list.querySelectorAll(".virtual-row").forEach(x => x.classList.remove("active"));
    const row = el.list.querySelector('.virtual-row[data-id="' + id + '"]');
    row && row.classList.add("active");
  }

  // 검색/필터 이벤트 + 저장된 뷰
  el.search?.addEventListener("input", () => { rebuildFiltered(); saveCurrentViewSilently(); });
  el.filter?.addEventListener("change", () => { rebuildFiltered(); saveCurrentViewSilently(); });

  const VIEWS_KEY = "editor.savedViews";
  function refreshSavedViews() {
    const list = store.get(VIEWS_KEY, []);
    if (!el.savedViews) return;
    el.savedViews.innerHTML = '<option value="">(뷰 선택)</option>' + list.map((v,i)=>`<option value="${i}">${escapeHtml(v.name)}</option>`).join('');
  }
  function saveCurrentViewSilently() {
    // 선택적: 최근 뷰를 별도 키에 저장해 초기 진입 시 복구하고 싶다면 구현 가능
  }
  el.saveViewBtn?.addEventListener("click", () => {
    const name = prompt("뷰 이름?"); if (!name) return;
    const list = store.get(VIEWS_KEY, []);
    list.push({ name, query: el.search?.value || "", filter: el.filter?.value || "all" });
    store.set(VIEWS_KEY, list);
    refreshSavedViews();
  });
  el.savedViews?.addEventListener("change", () => {
    const idx = Number(el.savedViews.value);
    const list = store.get(VIEWS_KEY, []);
    const v = list[idx]; if (!v) return;
    if (el.search) el.search.value = v.query;
    if (el.filter) el.filter.value = v.filter;
    rebuildFiltered();
  });

  async function loadList() {
    try {
      const j = await apiGet("/api/posts?limit=1000&offset=0");
      const rows = Array.isArray(j.list) ? j.list : (Array.isArray(j.rows) ? j.rows : []);
      // 최신순 정렬(가능하면 published/updated 기준)
      rows.sort((a, b) => {
        const da = new Date(a.published_at || a.updated_at || a.created_at || 0).getTime();
        const db = new Date(b.published_at || b.updated_at || b.created_at || 0).getTime();
        return db - da;
      });
      lastList = rows;
      refreshSavedViews();
      rebuildFiltered();
      setHint(lastList.length ? "" : "글이 없습니다. New로 작성해 보세요.", 2000);
    } catch (e) {
      console.error(e); setHint("목록 로드 실패: " + (e?.message || e));
      if (el.list) el.list.innerHTML = `<div style="color:#c00;padding:8px">API error<br><pre style="white-space:pre-wrap;max-height:260px;overflow:auto">${escapeHtml(String(e?.message||e))}</pre></div>`;
    }
  }

  async function openById(id) {
    try {
      const j = await apiGet("/api/posts/" + id);
      const rec = asItem(j);
      useRecord(rec);
      // 미리보기/TOC/미니맵 업데이트
      updatePreviewDeb();
      buildTOCDeb();
      updateMiniMapDeb();
      selectRowInList(id);
      setHint("Loaded", 1000);
    } catch (e) {
      console.error(e);
      setHint("Open error: " + (e?.message || e), 2000);
    }
  }

  /* ───────────────── 이미지/파일 업로드 → Blob → 본문 삽입 ───────────────── */
  async function uploadImageToBlob(file) {
    const tok = getToken();
    if (!tok) throw new Error("로그인 토큰이 없습니다.");
    const fd = new FormData();
    fd.set("file", file);
    const r = await fetch("/api/upload", { method: "POST", headers: { "x-editor-token": tok }, body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.url) throw new Error(j?.error || "upload failed");
    return j.url;
  }
  function insertMarkdownAtCursor(mdText) {
    if (mde && mde.codemirror) {
      const cm = mde.codemirror;
      const doc = cm.getDoc();
      const sel = doc.getSelection();
      if (sel && sel.length) doc.replaceSelection(mdText);
      else {
        const end = doc.getCursor("end");
        doc.replaceRange(mdText, end);
      }
      cm.focus();
    } else if (el.md) {
      const ta = el.md;
      const s = ta.selectionStart ?? ta.value.length;
      const e = ta.selectionEnd ?? ta.value.length;
      ta.value = ta.value.slice(0, s) + mdText + ta.value.slice(e);
      const pos = s + mdText.length;
      if (ta.setSelectionRange) ta.setSelectionRange(pos, pos);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  function bindImageUpload() {
    const btn = el.attachBtn;
    const input = el.attach;
    if (!btn || !input) return;
    btn.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const files = input.files ? Array.from(input.files) : [];
      if (!files.length) return;
      try {
        setHint("이미지 업로드 중…");
        const urls = [];
        for (const f of files) urls.push(await uploadImageToBlob(f));
        const block = urls.map(u => `![](${u})`).join("\n\n") + "\n";
        insertMarkdownAtCursor(block);
        setHint(`이미지 ${urls.length}개 삽입 완료`, 2000);
      } catch (e) {
        console.error(e);
        setHint("이미지 업로드 실패: " + (e?.message || e), 4000);
      } finally {
        input.value = "";
      }
    });
  }

  /* ───────────────── BIBTEX 업로드(reference.bib 고정) ───────────────── */
  async function uploadBibtex(file) {
    const tok = getToken();
    if (!tok) throw new Error("로그인 토큰이 없습니다.");
    const fd = new FormData();
    fd.set("file", file, "reference.bib");
    fd.set("name", "reference.bib");
    const r = await fetch("/api/upload?overwrite=1", { method: "POST", headers: { "x-editor-token": tok }, body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok !== true) throw new Error(j?.error || `HTTP ${r.status}`);
    return j.url;
  }
  function bindBibtexUpload() {
    const btn = document.getElementById("bibtexBtn");
    const input = document.getElementById("bibtexFile");
    if (!btn || !input) return;
    btn.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const f = input.files && input.files[0]; if (!f) return;
      try {
        setHint("BIBTEX 업로드 중…");
        await uploadBibtex(f);
        setHint("reference.bib 업로드 완료", 2000);
      } catch (e) {
        console.error(e); setHint("BIBTEX 업로드 실패: " + (e?.message || e), 4000);
      } finally { input.value = ""; }
    });
  }

  /* ───────────────── 저장/발행/삭제 ───────────────── */
  async function actionApply() {
    const data = readForm();
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
      useRecord(asItem(full));
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
        useRecord(asItem(full));
      }
    }
  }

  /* ───────────────── 자동저장(2.2s 디바운스) + 읽기 통계 ───────────────── */
  let _saveTimer;
  function scheduleAutosave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => { el.btnSave?.click(); }, 2200);
  }
  function readingStatFrom(text) {
    const chars = text.length;
    const words = (text.match(/\S+/g)||[]).length;
    const minutes = Math.max(1, Math.round(words/250));
    return `${chars}자 · ${minutes}분`;
  }

  /* ───────────────── 프리뷰 ───────────────── */
  async function updatePreview() {
    if (!el.previewFrame) return;
    const md = mde ? mde.value() : "";
    try {
      const j = await apiSend("/api/posts/preview", "POST", { md });
      const html = j?.html ? j.html : "<p>(preview failed)</p>";
      el.previewFrame.srcdoc = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/assets/style.css"><article class="post">${html}</article>`;
    } catch (e) {
      el.previewFrame.srcdoc = `<div class="preview-error">미리보기 실패: ${escapeHtml(e?.message || String(e))}</div>`;
    }
  }
  const updatePreviewDeb = debounce(updatePreview, 250);
  function togglePreview() {
    if (!el.previewPane || !el.previewBtn) return;
    const on = el.previewPane.hasAttribute("hidden");
    if (on) { el.previewPane.removeAttribute("hidden"); el.previewBtn.setAttribute("aria-pressed", "true"); updatePreview(); }
    else { el.previewPane.setAttribute("hidden", ""); el.previewBtn.setAttribute("aria-pressed", "false"); }
  }

  /* ───────────────── TOC / 미니맵 / 링크체커 ───────────────── */
  function buildTOC() {
    if (!el.toc) return;
    const md = mde?.value() || "";
    const heads = [...md.matchAll(/^#{1,3}\s+(.+)$/gm)].map(m => ({ level: (m[0].match(/^#+/)||[''])[0].length, text: m[1], idx: m.index }));
    el.toc.innerHTML = heads.map(h => `<a data-idx="${h.idx}" style="padding-left:${(h.level-1)*10}px">${escapeHtml(h.text)}</a>`).join("");
  }
  const buildTOCDeb = debounce(buildTOC, 250);
  el.toc?.addEventListener("click", e=>{
    const a = e.target.closest('a[data-idx]'); if(!a) return;
    const pos = Number(a.dataset.idx)||0;
    const cm = mde.codemirror;
    const doc = cm.getDoc();
    const where = doc.posFromIndex(pos);
    cm.focus(); doc.setCursor(where); cm.scrollIntoView(where, 80);
  });

  function updateMiniMap() {
    if (!el.minimap) return;
    const md = mde?.value() || "";
    const heads = [...md.matchAll(/^#{1,3}\s/gm)].map(m => m.index || 0);
    el.minimap.innerHTML = "";
    heads.forEach(i => {
      const y = (i / Math.max(1, md.length)) * 100;
      const dot = document.createElement("div");
      dot.style.position='absolute'; dot.style.left='2px';
      dot.style.top = `calc(${y}% - 2px)`; dot.style.width='6px'; dot.style.height='6px';
      dot.style.borderRadius='50%'; dot.style.background='#aaa';
      el.minimap.appendChild(dot);
    });
  }
  const updateMiniMapDeb = debounce(updateMiniMap, 300);

  async function checkLinks() {
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
  const checkLinksDeb = debounce(checkLinks, 2000);

  /* ───────────────── 이벤트/바인딩 ───────────────── */
  function debounce(fn, ms = 300) { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms) }; }

  // 에디터 준비
  try { await ensureEditor(); } catch (e) { console.error(e); setHint(e?.message || "에디터 로드 실패"); }
  bindImageUpload();
  bindBibtexUpload();

  // 버튼/폼
  el.btnNew && el.btnNew.addEventListener("click", (e)=>{ e.preventDefault();
    useRecord({ id:null, title:"", slug:"", tags:[], excerpt:"", is_page:false, published:false, body_md:"" });
    setHint("새 글");
  });
  el.btnSave && el.btnSave.addEventListener("click", (e)=>{ e.preventDefault();
    actionApply().catch(err => { console.error(err); setHint("저장 실패: " + (err?.message || err)); });
  });
  el.btnDelete && el.btnDelete.addEventListener("click", async (e)=>{ e.preventDefault();
    if (!state.id) { setHint("삭제할 항목이 없습니다.", 2000); return; }
    if (!confirm("정말 삭제할까요?")) return;
    await apiSend("/api/posts/" + state.id, "DELETE");
    setHint("삭제 완료", 2000);
    await loadList();
    useRecord({ id:null, title:"", slug:"", tags:[], excerpt:"", is_page:false, published:false, body_md:"" });
  });
  el.previewBtn && el.previewBtn.addEventListener("click", (e)=>{ e.preventDefault(); togglePreview(); });

  // 입력 변화
  el.title && el.title.addEventListener("input", () => {
    if (!state.id) { const s = slugify(el.title.value); el.slug && (el.slug.value = s); updatePermalink(s); }
    if (mde && el.readingStats) el.readingStats.textContent = readingStatFrom(mde.value()||"");
  });
  el.slug && el.slug.addEventListener("input", () => updatePermalink(el.slug.value));
  el.isPage && el.isPage.addEventListener("change", () => { const s = el.slug ? el.slug.value : (state.slug || ""); updatePermalink(s); });
  el.publishedToggle && el.publishedToggle.addEventListener("change", () => { el.status && (el.status.textContent = wantsPublished() ? "published" : "draft"); });

  // 본문 변경 → 자동저장/읽기통계/프리뷰/TOC/미니맵/링크체커
  mde?.codemirror.on("change", () => {
    scheduleAutosave();
    if (el.readingStats) el.readingStats.textContent = readingStatFrom(mde.value()||"");
    updatePreviewDeb();
    buildTOCDeb();
    updateMiniMapDeb();
    checkLinksDeb();
  });
  // 그 외 필드도 자동저장
  el.excerpt?.addEventListener("input", scheduleAutosave);
  el.tags?.addEventListener("input", scheduleAutosave);
  el.pubdate?.addEventListener("input", scheduleAutosave);
  el.pubtime?.addEventListener("input", scheduleAutosave);
  el.isPage?.addEventListener("change", scheduleAutosave);

  // Ctrl/Cmd+S → 저장
  window.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); el.btnSave?.click(); } });

  // 리스트 스크롤/검색/필터
  el.list?.addEventListener("scroll", debounce(renderVirtual, 16));
  el.search?.addEventListener("input", rebuildFiltered);
  el.filter?.addEventListener("change", rebuildFiltered);

  // 초기 로드
  await loadList();
  useRecord({ id:null, title:"", slug:"", tags:[], excerpt:"", is_page:false, published:false, body_md:"" });
  setHint("에디터 준비됨", 1200);
  wireLoginUI();
}

/* ───────────────── 부트스트랩(IIFE) ─────────────────
   - 서버가 이 파일만 주입하고, 모듈 안에서 즉시 initEditor()를 호출합니다.
*/
(function bootstrap() {
  // (선택) 외부에서 window.initEditor를 제공하면 그걸 우선
  if (typeof window !== "undefined" && typeof window.initEditor === "function") {
    window.initEditor();
  } else if (typeof initEditor === "function") {
    // 이 파일의 export 함수 직접 호출
    try {
      // DOM이 준비되었을 때 실행
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => { initEditor().catch(console.error); });
      } else {
        initEditor().catch(console.error);
      }
    } catch (e) {
      console.error(e);
    }
  } else {
    console.log("[editor] init bootstrap noop");
  }
})();

// public/assets/editor.js
export async function initEditor() {
  const $ = (s) => document.querySelector(s);

  function setHint(msg, ms) {
    const el = $("#hint");
    if (!el) return;
    el.textContent = msg || "";
    if (msg && ms) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, ms);
  }

  /* ───────────────── EasyMDE 로드 보강 ───────────────── */
  function injectEasyMDEAssets() {
    // 중복 삽입 방지
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
    // 이미 로드됐으면 패스
    if (typeof window.EasyMDE === "function") return;

    // 1차: 기존 <script>가 로딩되길 대기 (최대 ~5초)
    let t = 0;
    while (typeof window.EasyMDE !== "function" && t < 100) {
      await new Promise(r => setTimeout(r, 50)); t++;
    }
    if (typeof window.EasyMDE === "function") return;

    // 2차: 동적 삽입 후 다시 대기 (최대 ~10초)
    injectEasyMDEAssets();
    t = 0;
    while (typeof window.EasyMDE !== "function" && t < 200) {
      await new Promise(r => setTimeout(r, 50)); t++;
    }
    if (typeof window.EasyMDE !== "function") {
      throw new Error("EasyMDE가 로드되지 않았습니다(CDN 차단/지연).");
    }
  }

  /* ───────────────── 요청 유틸 ───────────────── */
  function getToken() {
    try {
      const cand = ["editor_token","x-editor-token","editorToken","xEditorToken"];
      for (const k of cand) { const v = localStorage.getItem(k); if (v) return v; }
    } catch {}
    const m = document.cookie.match(/(?:^|;\s*)(editor_token|editorToken)=([^;]+)/);
    return m ? decodeURIComponent(m[2]) : "";
  }
  // reference.bib 업로드
  async function uploadBibtex(file) {
    const tok = getToken();
    if (!tok) throw new Error("로그인 토큰이 없습니다.");

    const fd = new FormData();
    // 서버가 이름 기반으로 reference.bib 설정을 저장하므로, 이름을 고정합니다
    fd.set("file", file, "reference.bib");
    fd.set("name", "reference.bib");

    const r = await fetch("/api/upload?overwrite=1", {
      method: "POST",
      headers: { "x-editor-token": tok }, // multipart는 content-type 자동
      body: fd,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok !== true) {
      throw new Error(j?.error || `HTTP ${r.status}`);
    }
    return j.url;
  }

  function bindBibtexUpload() {
    const btn = document.getElementById("bibtexBtn");
    const input = document.getElementById("bibtexFile");
    if (!btn || !input) return;

    btn.addEventListener("click", () => input.click());

    input.addEventListener("change", async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try {
        setHint("BIBTEX 업로드 중…");
        await uploadBibtex(f);
        setHint("reference.bib 업로드 완료", 2000);
        // 필요하면 미리보기 재생성 트리거 등을 넣으세요
      } catch (e) {
        console.error(e);
        setHint("BIBTEX 업로드 실패: " + (e?.message || e), 4000);
      } finally {
        input.value = "";
      }
    });
  }
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

  /* ───────────────── 헬퍼 ───────────────── */
  function slugify(s) {
    return String(s || "").trim().toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-") || "post";
  }
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function formatDateTime(isoLike) {
    if (!isoLike) return "";
    const dt = new Date(isoLike); if (isNaN(dt.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  }

  /* ───────────────── DOM refs ───────────────── */
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
    btnDelete: $("#delete"),
    attachBtn: $("#attachBtn"),
    attach: $("#attach"),
  };

  /* ───────────────── EasyMDE 인스턴스 ───────────────── */
  let mde = null;
  async function ensureEditor() {
    await ensureEasyMDE();
    if (mde) return mde;
    if (!el.md) throw new Error("#md textarea not found");

    // 툴바 명시 + 이미지 버튼(파일 선택 열기)
    const toolbar = [
      "bold","italic","heading","|",
      "quote","unordered-list","ordered-list","|",
      "link",
      {
        name: "image-upload",
        action: () => el.attach && el.attach.click(),
        className: "fa fa-picture-o",
        title: "Insert image (upload)",
      },
      "|","preview","side-by-side","fullscreen","guide"
    ];

    mde = new window.EasyMDE({
      element: el.md,
      autofocus: false,
      spellChecker: false,
      autosave: { enabled: false },
      status: false,
      minHeight: "300px",
      placeholder: "Write in Markdown…",
      autoDownloadFontAwesome: false,
      toolbar,
    });
    return mde;
  }

  /* ───────────────── 상태 & 유틸 ───────────────── */
  let state = { id: null, slug: "", is_page: false, published: false };
  const wantsPublished = () => (el.publishedToggle ? !!el.publishedToggle.checked : false);

  function getPublishAtFromInputs() {
    const d = el.pubdate?.value || ""; const t = el.pubtime?.value || "";
    if (!d && !t) return null;
    return d ? (t ? `${d}T${t}:00` : `${d}T00:00:00`) : new Date().toISOString();
  }

  // 인코딩 없이, 표시/링크 모두 '한글 그대로'
  function computePermalink(slug) {
    const isPage = el.isPage ? !!el.isPage.checked : !!state.is_page;
    const base = isPage ? "/" : "/post/";
    const s = String(slug || "").trim();
    return base + (s ? s : "");
  }
  function updatePermalink(slug) {
    if (!el.permalink) return;
    const url = computePermalink(slug);
    // a.href 대신 setAttribute('href', ...) 를 써야 퍼센트 인코딩으로 변환되지 않습니다.
    if (el.permalink.tagName === "A") {
      el.permalink.setAttribute("href", url);
      el.permalink.textContent = "Permalink: " + url;
    } else {
      const a = el.permalink.querySelector?.("a");
      if (a) { a.setAttribute("href", url); a.textContent = url; }
      el.permalink.textContent = "Permalink: " + url;
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
    const tags = getTagsFromMulti();
    const excerpt = el.excerpt?.value || "";
    const is_page = el.isPage ? !!el.isPage.checked : false;
    const published = wantsPublished();
    const body_md = mde ? mde.value() : (el.md ? el.md.value : "");
    return { title, slug, tags, excerpt, is_page, published, body_md };
  }

  // ───────────── Tags Multi-Select ─────────────
  let __allTags = [];          // 전체 존재하는 태그 (DB 기반)
  let __currentTags = [];      // 현재 글의 태그

  async function loadAllTags() {
    try {
      const r = await fetch("/api/tags", { headers: { "cache-control": "no-store" } });
      if (!r.ok) return;
      const j = await r.json();
      __allTags = Array.isArray(j?.tags) ? j.tags : [];
    } catch {}
  }

  function getTagsFromMulti() {
    return __currentTags.slice();
  }

  function setTagsMulti(tags) {
    __currentTags = (Array.isArray(tags) ? tags : [])
      .map(t => String(t).trim())
      .filter(Boolean);
    // 중복 제거
    __currentTags = Array.from(new Set(__currentTags));
    renderTagsChips();
    syncHiddenTagsInput();
  }

  function syncHiddenTagsInput() {
    if (el.tags) el.tags.value = __currentTags.join(",");
  }

  function renderTagsChips() {
    const box = document.getElementById("tagsChips");
    if (!box) return;
    box.innerHTML = "";
    __currentTags.forEach((t) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.innerHTML = '<span class="tag-chip-label"></span><button type="button" class="tag-chip-x" aria-label="Remove">&times;</button>';
      chip.querySelector(".tag-chip-label").textContent = t;
      chip.querySelector(".tag-chip-x").addEventListener("click", () => {
        __currentTags = __currentTags.filter(x => x !== t);
        renderTagsChips();
        syncHiddenTagsInput();
      });
      box.appendChild(chip);
    });
  }

  function addTagFromInput() {
    const inp = document.getElementById("tagsInput");
    if (!inp) return;
    const raw = inp.value.trim().replace(/,$/, "").trim();
    if (!raw) return;
    if (!__currentTags.includes(raw)) {
      __currentTags.push(raw);
      renderTagsChips();
      syncHiddenTagsInput();
      // 새 태그면 전체 태그 목록에도 추가 (즉시 자동완성 반영)
      if (!__allTags.includes(raw)) __allTags.push(raw);
    }
    inp.value = "";
    hideSuggestions();
  }

  function showSuggestions(q) {
    const sugBox = document.getElementById("tagsSuggestions");
    if (!sugBox) return;
    const query = q.trim().toLowerCase();
    const matches = __allTags
      .filter(t => !__currentTags.includes(t))
      .filter(t => !query || t.toLowerCase().includes(query))
      .slice(0, 10);
    if (!matches.length) { hideSuggestions(); return; }
    sugBox.innerHTML = "";
    matches.forEach((t) => {
      const item = document.createElement("div");
      item.className = "tag-suggestion";
      item.textContent = t;
      item.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        __currentTags.push(t);
        renderTagsChips();
        syncHiddenTagsInput();
        const inp = document.getElementById("tagsInput");
        if (inp) inp.value = "";
        hideSuggestions();
      });
      sugBox.appendChild(item);
    });
    sugBox.hidden = false;
  }

  function hideSuggestions() {
    const sugBox = document.getElementById("tagsSuggestions");
    if (sugBox) sugBox.hidden = true;
  }

  function bindTagsMulti() {
    const inp = document.getElementById("tagsInput");
    const wrap = document.getElementById("tagsMulti");
    if (!inp || !wrap) return;

    // 포커스 시 전체 서제스천 표시
    inp.addEventListener("focus", () => showSuggestions(inp.value));
    inp.addEventListener("input", () => {
      // 마지막 문자가 콤마면 태그 확정
      if (inp.value.endsWith(",")) { addTagFromInput(); return; }
      showSuggestions(inp.value);
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTagFromInput();
      } else if (e.key === "Backspace" && !inp.value && __currentTags.length) {
        // 빈 입력에서 백스페이스 → 마지막 칩 제거
        __currentTags.pop();
        renderTagsChips();
        syncHiddenTagsInput();
      } else if (e.key === "Escape") {
        hideSuggestions();
      }
    });
    // 바깥 클릭 시 서제스천 닫기
    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) hideSuggestions();
    });
    // 컨테이너 클릭 시 입력 포커스
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap || e.target.id === "tagsChips") inp.focus();
    });
  }

  function selectRowInList(id) {
    if (!el.list) return;
    el.list.querySelectorAll(".virtual-row").forEach(x => x.classList.remove("active"));
    const row = el.list.querySelector('.virtual-row[data-id="' + id + '"]');
    row && row.classList.add("active");
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
    setTagsMulti(rec?.tags || []);
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

  /* ───────────────── 목록 ───────────────── */
  let lastList = [];
  async function loadList() {
    try {
      const j = await apiGet("/api/posts?limit=1000&offset=0");
      lastList = Array.isArray(j.list) ? j.list : [];
      renderList();
      setHint(lastList.length ? "" : "글이 없습니다. New로 작성해 보세요.", 3000);
    } catch (e) {
      console.error(e); setHint("목록 로드 실패: " + (e?.message || e));
    }
  }

  // public/assets/editor.js 안의 renderList() 를 아래로 교체
  function renderList() {
    if (!el.list) return;
    const q = (el.search?.value || "").toLowerCase();
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

    el.list.innerHTML = filtered.map((r) => {
      const dateStr = formatDateTime(r.published_at || r.updated_at || r.created_at);
      const status = r.published ? "published" : "draft";
      const badgeStyle = r.published
        ? "background:#e6f4ea;color:#0f5132"
        : "background:#fdecef;color:#842029";
      const tagsArr = Array.isArray(r.tags)
        ? r.tags
        : (r.tags ? String(r.tags).split(",").map(s=>s.trim()).filter(Boolean) : []);
      const tagsHtml = tagsArr
        .map(t => `<span class="tag" style="font-size:11px;padding:2px 6px;border-radius:6px;background:#f1f5f9">${escapeHtml(t)}</span>`)
        .join("");

      return `
        <div class="virtual-row" role="option" data-id="${r.id}" aria-selected="false" tabindex="0" style="padding:8px 10px;border-bottom:1px solid #eef2f7;">
          <!-- 제목: 전용 줄, 줄바꿈 허용(안 잘리게) -->
          <div class="title-line" style="font-weight:600;line-height:1.35;margin:0 0 4px 0;white-space:normal;word-break:break-word;">
            ${escapeHtml(r.title || "(untitled)")}
          </div>

          <!-- 메타: 다음 줄 -->
          <div class="meta-line" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;opacity:.85;">
            <span class="badge" style="padding:2px 8px;border-radius:999px;${badgeStyle}">${status}</span>
            ${r.slug ? `<span class="slug" style="opacity:.8">/${escapeHtml(r.is_page ? r.slug : "post/"+r.slug)}</span>` : ""}
            <span class="date" style="opacity:.7">${escapeHtml(dateStr)}</span>
          </div>

          <!-- 태그: 있으면 그 아래 줄 -->
          ${tagsArr.length ? `<div class="tags-line" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">${tagsHtml}</div>` : ""}
        </div>
      `;
    }).join("");

    // 바인딩 동일
    el.list.querySelectorAll(".virtual-row").forEach((row) => {
      row.addEventListener("click", async () => {
        const id = Number(row.getAttribute("data-id") || "0");
        if (!id) return;
        try { const j = await apiGet("/api/posts/" + id); useRecord(asItem(j)); }
        catch (e) { console.error(e); setHint("항목 로드 실패"); }
      });
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.click(); }
      });
    });
  }


  /* ───────────────── EasyMDE 커서에 Markdown 삽입 ───────────────── */
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

  /* ───────────────── Transcript 빌더 팝업 ───────────────── */
  function bindTranscriptInsert() {
    var btn = document.getElementById("transcriptBtn");
    if (!btn) return;

    var TYPES = [
      { value: "agent:thought",           label: "Agent: Thought",        icon: "\ud83d\udcad" },
      { value: "agent:send_message",      label: "Agent: Message",        icon: "\ud83d\udcac" },
      { value: "agent:tool_call",         label: "Agent: Tool call",      icon: "\ud83d\udd27" },
      { value: "agent:bash_tool",         label: "Agent: Bash",           icon: "\ud83d\udd27" },
      { value: "agent:code_write",        label: "Agent: Code",           icon: "\ud83d\udcbb" },
      { value: "result:chat_output",      label: "Result: Chat output",   icon: "\ud83e\udd16" },
      { value: "result:thinking",         label: "Result: Thinking",      icon: "\ud83d\udcad" },
      { value: "result:bash_output",      label: "Result: Bash output",   icon: "\ud83d\udce4" },
      { value: "summary:finding",         label: "Summary: Finding",      icon: "\ud83d\udd0d" },
      { value: "summary:critical_finding",label: "Summary: Critical",     icon: "\u26a0\ufe0f" },
    ];

    btn.addEventListener("click", function (e) {
      e.preventDefault();

      // 이미 열려있으면 무시
      if (document.getElementById("tv-builder-overlay")) return;

      // 오버레이
      var overlay = document.createElement("div");
      overlay.id = "tv-builder-overlay";
      overlay.className = "tv-builder-overlay";

      var panel = document.createElement("div");
      panel.className = "tv-builder-panel";

      // 헤더
      panel.innerHTML =
        '<div class="tv-builder-header">' +
          '<h3>Transcript Builder</h3>' +
          '<button type="button" class="tv-builder-close">\u00d7</button>' +
        '</div>' +
        '<div class="tv-builder-body">' +
          '<div class="tv-builder-field">' +
            '<label>Title</label>' +
            '<input type="text" id="tvTitle" placeholder="Transcript title" value="Transcript" />' +
          '</div>' +
          '<div id="tvEntries" class="tv-builder-entries"></div>' +
          '<div class="tv-builder-add-row">' +
            '<select id="tvTypeSelect"></select>' +
            '<button type="button" id="tvAddBtn">+ Add entry</button>' +
          '</div>' +
        '</div>' +
        '<div class="tv-builder-footer">' +
          '<button type="button" id="tvCancel">Cancel</button>' +
          '<button type="button" id="tvInsert" class="tv-btn-primary">Insert into editor</button>' +
        '</div>';

      overlay.appendChild(panel);
      document.body.appendChild(overlay);

      // select 옵션 채우기
      var sel = document.getElementById("tvTypeSelect");
      TYPES.forEach(function (t) {
        var opt = document.createElement("option");
        opt.value = t.value;
        opt.textContent = t.icon + " " + t.label;
        sel.appendChild(opt);
      });

      // 첫 엔트리 자동 추가
      addEntry();

      // 엔트리 추가
      function addEntry(typeVal) {
        var type = typeVal || sel.value;
        var info = TYPES.find(function (t) { return t.value === type; }) || TYPES[0];
        var container = document.getElementById("tvEntries");
        var idx = container.children.length;

        var row = document.createElement("div");
        row.className = "tv-entry-row";
        row.innerHTML =
          '<div class="tv-entry-header">' +
            '<span class="tv-entry-badge">' + info.icon + ' ' + info.label + '</span>' +
            '<button type="button" class="tv-entry-remove" title="Remove">\u00d7</button>' +
          '</div>' +
          '<textarea class="tv-entry-text" rows="3" placeholder="Enter content..." data-type="' + type + '"></textarea>';

        container.appendChild(row);

        // 삭제
        row.querySelector(".tv-entry-remove").addEventListener("click", function () {
          row.remove();
        });

        // 새로 추가된 textarea에 포커스
        var ta = row.querySelector("textarea");
        setTimeout(function () { ta.focus(); }, 50);
      }

      document.getElementById("tvAddBtn").addEventListener("click", function () { addEntry(); });

      // 닫기
      function close() { overlay.remove(); }
      panel.querySelector(".tv-builder-close").addEventListener("click", close);
      document.getElementById("tvCancel").addEventListener("click", close);
      overlay.addEventListener("click", function (ev) { if (ev.target === overlay) close(); });

      // 삽입
      document.getElementById("tvInsert").addEventListener("click", function () {
        var title = document.getElementById("tvTitle").value.trim() || "Transcript";
        var textareas = document.querySelectorAll("#tvEntries .tv-entry-text");
        if (!textareas.length) { close(); return; }

        var md = '\n:::transcript "' + title + '"\n';
        textareas.forEach(function (ta) {
          var type = ta.dataset.type;
          var content = ta.value.trim();
          if (content) {
            md += "\n> " + type + "\n" + content + "\n";
          }
        });
        md += "\n:::end\n";

        insertMarkdownAtCursor(md);
        close();
      });
    });
  }

  /* ───────────────── 이미지 업로드 → Blob → 본문 삽입 ───────────────── */
  // XHR 기반 업로드 (진행률 콜백 지원)
  function uploadImageToBlob(file, onProgress) {
    return new Promise((resolve, reject) => {
      const tok = getToken();
      if (!tok) return reject(new Error("로그인 토큰이 없습니다."));

      const fd = new FormData();
      fd.set("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");
      xhr.setRequestHeader("x-editor-token", tok);

      // 업로드 진행률 이벤트
      if (xhr.upload && typeof onProgress === "function") {
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            onProgress(pct, e.loaded, e.total);
          }
        });
      }

      xhr.onload = () => {
        let j = {};
        try { j = JSON.parse(xhr.responseText || "{}"); } catch {}
        if (xhr.status >= 200 && xhr.status < 300 && j.url) {
          resolve(j.url);
        } else {
          reject(new Error(j.error || `upload failed: ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("network error during upload"));
      xhr.onabort = () => reject(new Error("upload aborted"));

      xhr.send(fd);
    });
  }

  function fmtBytes(n) {
    if (n < 1024) return n + "B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + "KB";
    return (n / 1024 / 1024).toFixed(1) + "MB";
  }

  function bindImageUpload() {
    const btn = el.attachBtn;
    const input = el.attach;
    if (!btn || !input) return;

    btn.addEventListener("click", () => input.click());

    input.addEventListener("change", async () => {
      const files = input.files ? Array.from(input.files) : [];
      if (!files.length) return;
      const total = files.length;
      try {
        const urls = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const idx = i + 1;
          const url = await uploadImageToBlob(f, (pct, loaded, totalBytes) => {
            setHint(
              `이미지 업로드 (${idx}/${total}) ${f.name} — ${pct}% (${fmtBytes(loaded)}/${fmtBytes(totalBytes)})`
            );
          });
          urls.push(url);
        }
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

  /* ───────────────── 저장(토글 상태 그대로 적용) ───────────────── */
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

  /* ───────────────── 미리보기 ───────────────── */
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
  function togglePreview() {
    if (!el.previewPane || !el.previewBtn) return;
    const on = el.previewPane.hasAttribute("hidden");
    if (on) { el.previewPane.removeAttribute("hidden"); el.previewBtn.setAttribute("aria-pressed", "true"); updatePreview(); }
    else { el.previewPane.setAttribute("hidden", ""); el.previewBtn.setAttribute("aria-pressed", "false"); }
  }

  /* ───────────────── 바인딩 ───────────────── */
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

  el.title && el.title.addEventListener("input", () => {
    if (!state.id) { const s = slugify(el.title.value); el.slug && (el.slug.value = s); updatePermalink(s); }
  });
  el.slug && el.slug.addEventListener("input", () => updatePermalink(el.slug.value));
  el.isPage && el.isPage.addEventListener("change", () => {
    const s = el.slug ? el.slug.value : (state.slug || ""); updatePermalink(s);
  });
  el.publishedToggle && el.publishedToggle.addEventListener("change", async () => {
    el.status && (el.status.textContent = wantsPublished() ? "published" : "draft");
    // 자동 저장 (이미 저장된 글일 때만 — 새 글은 title 입력 후 수동 저장)
    if (state.id) {
      try {
        setHint(wantsPublished() ? "발행 중…" : "비공개 전환 중…");
        await actionApply();
      } catch (e) {
        console.error("auto-save on published toggle failed:", e);
        setHint("자동 저장 실패: " + (e?.message || e), 3000);
      }
    }
  });
  el.search && el.search.addEventListener("input", renderList);
  el.filter && el.filter.addEventListener("change", renderList);

  // Ctrl/Cmd+S → 저장
  window.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); el.btnSave?.click(); } });

  /* ───────────────── 부팅 ───────────────── */
  try { await ensureEditor(); } catch (e) { console.error(e); setHint(e?.message || "에디터 로드 실패"); }
  bindImageUpload();
  bindBibtexUpload();
  bindTranscriptInsert();
  bindTagsMulti();
  loadAllTags();
  await loadList();
  useRecord({ id:null, title:"", slug:"", tags:[], excerpt:"", is_page:false, published:false, body_md:"" });
  setHint("에디터 준비됨", 1500);
}

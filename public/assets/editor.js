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

  function computePermalink(slug) {
    const isPage = el.isPage ? !!el.isPage.checked : !!state.is_page;
    const base = isPage ? "/" : "/post/"; const s = String(slug || "").trim();
    return base + (s ? encodeURIComponent(s) : "");
  }
  function updatePermalink(slug) {
    el.permalink && (el.permalink.textContent = "Permalink: " + computePermalink(slug));
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
    el.tags && (el.tags.value = (rec?.tags || []).join(", "));
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

  /* ───────────────── 이미지 업로드 → Blob → 본문 삽입 ───────────────── */
  async function uploadImageToBlob(file) {
    const tok = getToken();
    if (!tok) throw new Error("로그인 토큰이 없습니다.");
    const fd = new FormData();
    fd.set("file", file);
    const r = await fetch("/api/upload", {
      method: "POST",
      headers: { "x-editor-token": tok }, // content-type 지정 금지
      body: fd,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.url) throw new Error(j?.error || "upload failed");
    return j.url;
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
  el.publishedToggle && el.publishedToggle.addEventListener("change", () => {
    el.status && (el.status.textContent = wantsPublished() ? "published" : "draft");
  });
  el.search && el.search.addEventListener("input", renderList);
  el.filter && el.filter.addEventListener("change", renderList);

  // Ctrl/Cmd+S → 저장
  window.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); el.btnSave?.click(); } });

  /* ───────────────── 부팅 ───────────────── */
  try { await ensureEditor(); } catch (e) { console.error(e); setHint(e?.message || "에디터 로드 실패"); }
  bindImageUpload();
  await loadList();
  useRecord({ id:null, title:"", slug:"", tags:[], excerpt:"", is_page:false, published:false, body_md:"" });
  setHint("에디터 준비됨", 1500);
}

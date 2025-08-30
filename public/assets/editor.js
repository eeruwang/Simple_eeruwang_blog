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
      const cand = ["editor_token","x-editor-token","editorToken","xEditorToken"];
      for (const k of cand) { const v = localStorage.getItem(k); if (v) return v; }
    } catch {}
    const m = document.cookie.match(/(?:^|;\s*)(editor_token|editorToken)=([^;]+)/);
    return m ? decodeURIComponent(m[2]) : "";
  }
  function authHeaders(h) {
    const tok = getToken();
    const base = h && typeof h === "object" ? h : {};
    return tok ? { ...base, "x-editor-token": tok } : base;
  }
  // 캐시 무효화 GET
  async function apiGet(url) {
    const sep = url.includes("?") ? "&" : "?";
    const bust = `${sep}ts=${Date.now()}`;
    const r = await fetch(url + bust, { headers: authHeaders(), cache: "no-store" });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch {}
    if (!r.ok) throw new Error((j && j.error) || r.statusText || ("GET " + url + " failed"));
    return j;
  }
  // 쓰기 요청
  async function apiSend(url, method, body) {
    const r = await fetch(url, {
      method,
      headers: authHeaders({ "content-type": "application/json" }),
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch {}
    if (!r.ok) throw new Error((j && j.error) || r.statusText || (method + " " + url + " failed"));
    return j;
  }
  // API 응답 언래핑
  function asItem(resp) {
    if (!resp) return null;
    if (resp.item) return resp.item;
    if (resp.updated) return resp.updated;
    if (resp.created && Array.isArray(resp.created) && resp.created[0]) return resp.created[0];
    return resp;
  }

  // ----- 헬퍼 -----
  function slugify(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-") || "post";
  }
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }
  function formatDateTime(isoLike) {
    if (!isoLike) return "";
    const dt = new Date(isoLike);
    if (isNaN(dt.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return (
      dt.getFullYear() + "-" +
      pad(dt.getMonth() + 1) + "-" +
      pad(dt.getDate()) + " " +
      pad(dt.getHours()) + ":" +
      pad(dt.getMinutes())
    );
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
    btnSave: $("#save"),       // ✅ 단일 Save 버튼만 사용
    btnPublish: $("#publish"), // 있으면 숨김 처리
    btnDelete: $("#delete"),
  };

  // 기존 publish 버튼이 있으면 숨긴다(HTML 수정 없이도 동작)
  if (el.btnPublish) {
    el.btnPublish.style.display = "none";
    el.btnPublish.setAttribute("hidden", "");
    el.btnPublish.disabled = true;
  }

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

  // ----- 상태 & 유틸 -----
  let state = { id: null, slug: "", is_page: false, published: false };

  function wantsPublished() {
    return el.publishedToggle ? !!el.publishedToggle.checked : false;
  }
  function getPublishAtFromInputs() {
    const d = (el.pubdate && el.pubdate.value) ? el.pubdate.value : "";
    const t = (el.pubtime && el.pubtime.value) ? el.pubtime.value : "";
    if (!d && !t) return null;
    return d ? (t ? (d + "T" + t + ":00") : (d + "T00:00:00")) : new Date().toISOString();
  }

  function computePermalink(slug) {
    const isPage = el.isPage ? !!el.isPage.checked : !!state.is_page;
    const base = isPage ? "/" : "/post/";
    const s = String(slug || "").trim();
    return base + (s ? encodeURIComponent(s) : "");
  }
  function updatePermalink(slug) {
    if (!el.permalink) return;
    el.permalink.textContent = "Permalink: " + computePermalink(slug);
  }

  function readTagsInput(val) {
    if (Array.isArray(val)) return val.map(String);
    return String(val || "").split(",").map(s => s.trim()).filter(Boolean);
  }
  function readForm() {
    const title = el.title ? el.title.value : "";
    const slugIn = el.slug ? el.slug.value : "";
    const slug = (slugIn || slugify(title)).trim();
    const tags = readTagsInput(el.tags ? el.tags.value : "");
    const excerpt = el.excerpt ? el.excerpt.value : "";
    const is_page = el.isPage ? !!el.isPage.checked : false;
    const published = wantsPublished();
    const body_md = mde ? mde.value() : (el.md ? el.md.value : "");
    return { title, slug, tags, excerpt, is_page, published, body_md };
  }

  function selectRowInList(id) {
    if (!el.list) return;
    el.list.querySelectorAll(".virtual-row").forEach(x => x.classList.remove("active"));
    const row = el.list.querySelector('.virtual-row[data-id="' + id + '"]');
    if (row) row.classList.add("active");
  }

  function useRecord(rec) {
    if (!rec) return;
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
    refreshSaveButtonLabel();
  }

  // ----- 목록 -----
  let lastList = [];
  async function loadList() {
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

    el.list.innerHTML = filtered.map((r) => {
      const dateStr = formatDateTime(r.published_at || r.updated_at || r.created_at);
      const status = r.published ? "published" : "draft";
      const badgeStyle = r.published
        ? "background:#e6f4ea;color:#0f5132"
        : "background:#fdecef;color:#842029";

      const tagsArr = Array.isArray(r.tags)
        ? r.tags
        : (r.tags ? String(r.tags).split(",").map(s=>s.trim()).filter(Boolean) : []);

      const tagsHtml = tagsArr.map(t =>
        `<span class="tag" style="font-size:11px;padding:2px 6px;border-radius:6px;background:#f1f5f9">${escapeHtml(t)}</span>`
      ).join("");

      return `
        <div class="virtual-row" role="option" data-id="${r.id}" aria-selected="false" tabindex="0">
          <div class="row" style="display:flex;gap:10px;align-items:center">
            <strong style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${escapeHtml(r.title || "(untitled)")}
            </strong>
            <span style="font-size:12px;opacity:.7">${escapeHtml(r.slug || "")}</span>
            <div class="meta" style="margin-left:auto;display:flex;gap:8px;align-items:center;font-size:12px;">
              <span class="badge" style="padding:2px 8px;border-radius:999px;${badgeStyle}">${status}</span>
              <span>${escapeHtml(dateStr)}</span>
            </div>
          </div>
          ${tagsArr.length
            ? `<div class="tags" style="margin-top:4px;display:flex;gap:6px;flex-wrap:wrap;">${tagsHtml}</div>`
            : ""
          }
        </div>`;
    }).join("");

    el.list.querySelectorAll(".virtual-row").forEach((row) => {
      row.addEventListener("click", async () => {
        const id = Number(row.getAttribute("data-id") || "0");
        if (!id) return;
        try {
          const j = await apiGet("/api/posts/" + id);
          const rec = asItem(j);
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

  // ----- 단일 Save 로직 (토글 상태 그대로 적용) -----
  async function actionApply() {
    const data = readForm();
    const wantPub = data.published;

    // 토글 상태를 그대로 반영
    const payload = { ...data };

    if (state.id) {
      // 업데이트
      if (wantPub) {
        const at = getPublishAtFromInputs();
        if (at !== null) payload.published_at = at; // 사용자가 지정한 시간
        else delete payload.published_at;           // 없는 경우 now() 자동 채움
      } else {
        payload.published_at = null;                // 초안으로: 비우기
      }

      const j = await apiSend("/api/posts/" + state.id, "PUT", payload);
      setHint(wantPub ? "발행 적용 완료" : "초안으로 저장 완료", 2000);
      await loadList();
      const full = await apiGet("/api/posts/" + state.id);
      useRecord(asItem(full));
    } else {
      // 새 글 생성
      if (wantPub) {
        const at = getPublishAtFromInputs();
        if (at !== null) payload.published_at = at;
        else delete payload.published_at;
      } else {
        payload.published_at = null;
      }

      const j = await apiSend("/api/posts", "POST", payload);
      setHint(wantPub ? "발행 완료" : "초안 생성 완료", 2000);

      await loadList();
      const created = asItem(j);
      if (created && created.id) {
        const full = await apiGet("/api/posts/" + created.id);
        useRecord(asItem(full));
      }
    }
  }

  // ----- 미리보기 -----
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
      updatePreview();
    } else {
      el.previewPane.setAttribute("hidden", "");
      el.previewBtn.setAttribute("aria-pressed", "false");
    }
  }

  // ----- Save 버튼 라벨 동기화 -----
  function refreshSaveButtonLabel() {
    if (!el.btnSave) return;
    el.btnSave.textContent = wantsPublished() ? "Save (Publish)" : "Save (Draft)";
  }

  // ----- 바인딩 -----
  el.btnNew && el.btnNew.addEventListener("click", (e)=>{ e.preventDefault(); useRecord({ id:null, title:"", slug:"", tags:[], excerpt:"", is_page:false, published:false, body_md:"" }); setHint("새 글"); refreshSaveButtonLabel(); });
  el.btnSave && el.btnSave.addEventListener("click", (e)=>{ e.preventDefault(); actionApply().catch(err => { console.error(err); setHint("저장 실패: " + (err?.message || err)); }); });
  el.btnDelete && el.btnDelete.addEventListener("click", async (e)=>{ e.preventDefault();
    if (!state.id) { setHint("삭제할 항목이 없습니다.", 2000); return; }
    if (!confirm("정말 삭제할까요?")) return;
    await apiSend("/api/posts/" + state.id, "DELETE");
    setHint("삭제 완료", 2000);
    await loadList();
    useRecord({ id:null, title:"", slug:"", tags:[], excerpt:"", is_page:false, published:false, body_md:"" });
    refreshSaveButtonLabel();
  });
  el.previewBtn && el.previewBtn.addEventListener("click", (e)=>{ e.preventDefault(); togglePreview(); });

  el.title && el.title.addEventListener("input", () => {
    if (!state.id) {
      const s = slugify(el.title.value);
      if (el.slug) el.slug.value = s;
      updatePermalink(s);
    }
  });
  el.slug && el.slug.addEventListener("input", () => updatePermalink(el.slug.value));
  el.isPage && el.isPage.addEventListener("change", () => {
    const s = el.slug ? el.slug.value : (state.slug || "");
    updatePermalink(s);
  });
  el.publishedToggle && el.publishedToggle.addEventListener("change", () => {
    if (el.status) el.status.textContent = wantsPublished() ? "published" : "draft";
    refreshSaveButtonLabel();
  });
  el.search && el.search.addEventListener("input", renderList);
  el.filter && el.filter.addEventListener("change", renderList);

  // Ctrl+S → 저장
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      el.btnSave?.click();
    }
  });

  // ----- 부팅 -----
  try {
    await ensureEditor();
  } catch (e) {
    console.error(e);
    setHint(e && e.message ? e.message : "에디터 로드 실패");
  }
  await loadList();
  useRecord({ id:null, title:"", slug:"", tags:[], excerpt:"", is_page:false, published:false, body_md:"" });
  refreshSaveButtonLabel();
  setHint("에디터 준비됨", 1500);
}

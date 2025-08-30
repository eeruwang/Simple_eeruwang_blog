// src/editor.client.ts
import { normalizeSlug } from "./lib/slug";

export const EDITOR_CLIENT_JS: string = `
// ===== editor.js (browser) =====
(() => {
  console.log("[editor] loaded");

  // Bring server-side normalizeSlug into browser scope
  const normalizeSlug = ${normalizeSlug.toString()};

  let STATE = {
    key: "",
    currentId: null,
    status: "draft",
    slugTouched: false,
    suspendAutosave: false
  };

  const $ = (s)=>document.querySelector(s);
  const $list = $("#postVirtualList");            // 가상 리스트 컨테이너
  const $hint = $("#hint"), $status=$("#status");
  const $isPage = $("#is_page");
  const $permalink = $("#permalink");
  const $previewToggleBtn = $("#previewToggleBtn");
  const $previewPane = $("#previewPane");
  const $previewFrame = $("#previewFrame");
  const $saveBtn = $("#save");
  const $publishBtn = $("#publish");
  const $publishedToggle = $("#publishedToggle");
  const $saveState = $("#saveState");
  const $readingStats = $("#readingStats");
  const $sideToggle = $("#sideToggle");

  // EasyMDE 초기화
  const mde = new EasyMDE({
    element: document.getElementById("md"),
    spellChecker: false,
    autofocus: false,
    autosave: { enabled: false },
    renderingConfig: { codeSyntaxHighlighting: true }
  });
  window._mde = mde;

  // ===== 공통 유틸 =====
  function headers(){ return { "content-type":"application/json", "x-editor-token": STATE.key }; }
  function tagsArr(){
    return ($("#tags").value || "").split(",").map(s=>s.trim()).filter(Boolean);
  }
  function toIsoLocal(dateStr, timeStr) {
    try {
      if (!dateStr && !timeStr) return new Date().toISOString();
      const [y,m,d] = (dateStr || new Date().toISOString().slice(0,10)).split("-").map(Number);
      const [hh,mm] = (timeStr || "00:00").split(":").map(Number);
      const dt = new Date(y, (m||1)-1, d||1, hh||0, mm||0);
      return dt.toISOString();
    } catch { return new Date().toISOString(); }
  }
  function isoToParts(iso){
    if (!iso) return { date:"", time:"" };
    const dt = new Date(iso);
    if (String(dt) === "Invalid Date") return { date:"", time:"" };
    const pad = (n)=>String(n).padStart(2,"0");
    return {
      date: dt.getFullYear()+"-"+pad(dt.getMonth()+1)+"-"+pad(dt.getDate()),
      time: pad(dt.getHours())+":"+pad(dt.getMinutes())
    };
  }
  function hasMeaningfulContent(){
    const title = ($("#title").value || "").trim();
    const body  = (mde.value() || "").replace(/\\s+/g, "");
    return title.length > 0 || body.length > 0;
  }

  // 한글 보존 슬러그 (서버 normalizeSlug와 동일 동작)
  function slugify(s){
    return normalizeSlug(String(s||""));
  }

  // 기존 updatePermalink()를 아래로 교체
  function updatePermalink(){
    if (!$permalink) return;

    const raw  = ($("#slug").value || "").trim();
    const base = raw || $("#title").value || "";
    const slug = slugify(base);                       // 한글 보존 정규화
    const enc  = encodeURIComponent(slug);
    const isPage = !!($isPage && $isPage.checked);

    // 보기용(사람이 읽는 텍스트) vs. 실제 이동용(href)
    const pathPretty = isPage ? ("/" + slug) : ("/post/" + slug);  // 한글 그대로
    const pathHref   = isPage ? ("/" + enc ) : ("/post/" + enc );  // 인코딩

    // 텍스트는 한글 그대로
    $permalink.textContent = "Permalink: " + pathPretty;

    // a 태그라면 href도 세팅
    if ("setAttribute" in $permalink) {
      try { $permalink.setAttribute("href", pathHref); } catch {}
      // (옵션) 디버깅/복사용으로 인코딩 값을 data-attr에 보관
      try { $permalink.setAttribute("data-href-encoded", pathHref); } catch {}
    }
  }


  function pickDateField(f) {
    return f.published_at || f.Published_at || f.UpdatedAt || f.CreatedAt || "";
  }
  function fmtDate(s) {
    if (!s) return "";
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const pad = n => String(n).padStart(2,"0");
    return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+" "+pad(d.getHours())+":"+pad(d.getMinutes());
  }
  
  function escapeHtml(s){
    return String(s || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  }

  function setStatus(s){ STATE.status=s; if($status) $status.textContent=s; }
  function setHint(t){
    if($hint){ $hint.textContent=t; setTimeout(()=>{ if($hint.textContent===t) $hint.textContent=""; }, 2000); }
  }
  async function readTextSafe(res){ try { return await res.text(); } catch { return ""; } }

  // ===== 로그인 =====
  async function tryOpenWithKey(key){
    if(!key) return false;
    try{
      const r = await fetch("/api/check-key", { headers: { "x-editor-token": key } });
      if(!r.ok) return false;
      STATE.key = key;
      window.EDITOR_KEY = key;
      sessionStorage.setItem("editor_key", key);
      document.body.setAttribute("data-auth","1");
      loadList();
      return true;
    }catch(_){ return false; }
  }
  const lockBtn = document.getElementById("signin");
  const lockInput = document.getElementById("key");
  const lockHint = document.getElementById("lock-hint");
  if(lockBtn && lockInput){
    lockBtn.addEventListener("click", async ()=>{
      const ok = await tryOpenWithKey(lockInput.value.trim());
      if(!ok && lockHint) lockHint.textContent = "비밀번호가 올바르지 않습니다.";
    });
    lockInput.addEventListener("keydown", (e)=>{
      if(e.key === "Enter") lockBtn.click();
    });
  }
  (async ()=>{
    const saved = sessionStorage.getItem("editor_key");
    if(saved) await tryOpenWithKey(saved);
  })();

  // ===== 새 글 =====
  const btnNew = document.getElementById("new");
  if(btnNew){
    btnNew.onclick = ()=>{
      STATE.currentId = null;
      window.currentPostId = null;
      $("#title").value = "";
      $("#slug").value = "";
      $("#tags").value = "";
      const ex = document.getElementById("excerpt"); if (ex) ex.value = "";
      const pd = document.getElementById("pubdate"); if (pd) pd.value = "";
      const pt = document.getElementById("pubtime"); if (pt) pt.value = "";
      if ($isPage) $isPage.checked = false;
      mde.value("");
      setStatus("draft");
      STATE.slugTouched = false;
      STATE.suspendAutosave = false;
      updatePermalink();
      setActiveRow(null);
    };
  }

  // ===== 슬러그 자동/수동 =====
  const slugEl = document.getElementById("slug");
  const titleEl = document.getElementById("title");
  if(slugEl) slugEl.addEventListener("input", ()=>{ STATE.slugTouched = true; updatePermalink(); });
  if(titleEl){
    titleEl.addEventListener("input", ()=>{
      const auto = slugify($("#title").value);
      const cur  = ($("#slug").value || "").trim();
      if (!STATE.slugTouched || !cur || cur === slugify(cur.replace(/-/g,' '))) {
        $("#slug").value = auto;
      }
      updatePermalink();
      scheduleAutosave();
    });
  }
  if ($isPage) $isPage.addEventListener("change", updatePermalink);

  // ===== 저장/발행/삭제 =====
  const btnSave = document.getElementById("save");
  const btnPub  = document.getElementById("publish");
  if(btnSave) btnSave.onclick = ()=>save("draft");
  if(btnPub)  btnPub.onclick  = ()=>save("published");

  const btnDel = document.getElementById("delete");
  if(btnDel){
    btnDel.onclick = async ()=>{
      if(!STATE.key) return alert("Sign in first");
      if(!STATE.currentId) return alert("삭제할 글이 선택되지 않았습니다.");
      if(!confirm("정말 삭제하시겠습니까?")) return;

      const res = await fetch(\`/api/posts/\${encodeURIComponent(STATE.currentId)}\`, {
        method: "DELETE",
        headers: headers()
      });
      if(!res.ok){
        const txt = await readTextSafe(res);
        console.error("Delete error:", txt);
        return alert("삭제 실패: " + (txt || res.status));
      }
      setHint("Deleted");
      STATE.currentId = null;
      window.currentPostId = null;
      $("#title").value = "";
      $("#slug").value = "";
      $("#tags").value = "";
      const ex = document.getElementById("excerpt"); if (ex) ex.value = "";
      const pd = document.getElementById("pubdate"); if (pd) pd.value = "";
      const pt = document.getElementById("pubtime"); if (pt) pt.value = "";
      if ($isPage) $isPage.checked = false;
      mde.value("");
      setStatus("draft");
      updatePermalink();
      loadList();
    };
  }

  async function save(nextStatus){
    if(!STATE.key) return alert("Sign in first");
    if (!hasMeaningfulContent()) { setHint("제목이나 본문을 입력하세요"); return; }

    // Publish 시에만 published_at 실어 보냄 (비어있으면 now)
    let published_at;
    if (nextStatus === "published") {
      const pd = document.getElementById("pubdate")?.value || "";
      const pt = document.getElementById("pubtime")?.value || "";
      published_at = toIsoLocal(pd, pt);
    }

    const inputSlug = ($("#slug").value || "").trim();
    const titleBase = ($("#title").value || "").trim();
    const finalSlug = slugify(inputSlug || titleBase);

    const payload = {
      title: titleBase || "(untitled)",
      body_md: mde.value(),
      slug: finalSlug,
      tags: tagsArr(),
      excerpt: ($("#excerpt")?.value || "").trim(),
      is_page: !!($isPage && $isPage.checked),
      published: nextStatus === "published",
      ...(published_at ? { published_at } : {})
    };

    let res;
    if(STATE.currentId){
      res = await fetch(\`/api/posts/\${STATE.currentId}\`, {
        method:"PATCH", headers: headers(), body: JSON.stringify(payload)
      });
    } else {
      res = await fetch("/api/posts", {
        method:"POST", headers: headers(), body: JSON.stringify([payload])
      });
    }

    if(!res.ok){
      const txt = await readTextSafe(res);
      console.error("Save error:", txt);
      setHint("Save error");
      if($list){
        $list.innerHTML = '<div style="color:#c00">API error ('+res.status+')<br><pre style="white-space:pre-wrap;max-height:260px;overflow:auto">'+(txt||"").slice(0,2000)+'</pre></div>';
      }
      return;
    }

    const data = await res.json().catch(()=> ({}));
    const id =
      data?.[0]?.Id || data?.[0]?.id ||
      data?.rows?.[0]?.Id || data?.rows?.[0]?.id ||
      data?.record?.Id || data?.record?.id ||
      data?.Id || data?.id;
    if(id) { STATE.currentId = id; window.currentPostId = id; }

    setStatus(nextStatus);
    setHint(nextStatus==="published" ? "Published" : "Saved");
    loadList();
  }

  // ===== 자동 저장 (2.2s 디바운스) =====
  let typingTimer;
  function scheduleAutosave(){
    if (STATE.suspendAutosave || !STATE.key) return;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(()=>{
      if (!hasMeaningfulContent()) return;
      const mode = (STATE.status === "published") ? "published" : "draft";
      save(mode);
    }, 2200);
  }
  mde.codemirror.on("change", scheduleAutosave);
  const exEl = document.getElementById("excerpt");
  const tgEl = document.getElementById("tags");
  const pdEl = document.getElementById("pubdate");
  const ptEl = document.getElementById("pubtime");
  if (exEl) exEl.addEventListener("input", scheduleAutosave);
  if (tgEl) tgEl.addEventListener("input", scheduleAutosave);
  if (titleEl) titleEl.addEventListener("input", scheduleAutosave);
  if (pdEl) pdEl.addEventListener("input", scheduleAutosave);
  if (ptEl) ptEl.addEventListener("input", scheduleAutosave);
  if ($isPage) $isPage.addEventListener("change", scheduleAutosave);

  // ===== 목록/검색/가상 스크롤 =====
  const searchInput = $("#searchInput");
  const filterSelect = $("#filterSelect");
  const savedViews = $("#savedViews");
  const saveViewBtn = $("#saveViewBtn");

  const debounce = (fn, ms=300)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms)}};
  const store = {
    get(k,d){ try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  // 반응형 전환 + 사이드 열고닫기 컨트롤러
  const mq = window.matchMedia('(max-width: 900px)');
  const isM = () => mq.matches;

  function setMobileOpen(on) {
    document.body.classList.toggle('side-open', !!on); // 모바일 오버레이(몸통 클래스)
  }

  // 초기 진입 시 상태 동기화
  function syncOnLoad() {
    if (isM()) {
      // 모바일로 들어왔으면 데스크탑 접힘 상태는 강제로 해제
      document.body.classList.remove('side-collapsed');
    }
    setMobileOpen(false); // 기본은 닫힘
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncOnLoad);
  } else {
    syncOnLoad();
  }

  // 토글 버튼 동작: 모바일=오버레이, 데스크탑=접힘 토글
  $sideToggle?.addEventListener('click', () => {
    if (isM()) {
      setMobileOpen(!document.body.classList.contains('side-open'));
    } else {
      document.body.classList.toggle('side-collapsed');
    }
  });

  // 뷰포트 전환 시 상태 정리
  mq.addEventListener?.('change', () => {
    if (isM()) {
      // 모바일로 진입하면 데스크탑용 접힘 상태를 반드시 풀어야 토글이 보임
      document.body.classList.remove('side-collapsed');
      setMobileOpen(false);
    } else {
      // 데스크탑 복귀 시 모바일 오버레이는 닫기
      setMobileOpen(false);
    }
  });

  // 배경 클릭/ESC로 모바일 오버레이 닫기(있으면)
  document.getElementById('sideBackdrop')?.addEventListener('click', () => setMobileOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMobileOpen(false); });

  let allPosts = [];   // [{ fields: {...} }]
  let filtered = [];
  let rowH = 120;

  function matches(r){
    const f = r.fields || r;
    const q = (searchInput?.value||'').toLowerCase();
    const hitQ = !q || (f.title||"").toLowerCase().includes(q) || String(f.tags||"").toLowerCase().includes(q);
    const fsel = filterSelect?.value || 'all';
    const isPub = !!(f.published ?? f.Published);
    const isPage = !!(f.is_page ?? f.Is_page);
    const hitF = fsel==='all'
      || (fsel==='published' && isPub)
      || (fsel==='draft' && !isPub)
      || (fsel==='page' && isPage)
      || (fsel==='post' && !isPage);
    return hitQ && hitF;
  }

  function rebuildFiltered(){
    filtered = allPosts.filter(matches);
    if ($list) { $list.scrollTop = 0; renderVirtual(); }
  }

  // 기존 permalinkOf(f)를 아래로 교체
  function permalinkOf(f){
    const slug = (f.slug || "").trim();
    if (!slug) return "";
    const base = (f.is_page || f.Is_page) ? "/" : "/post/";
    return base + slug;            // 표시용(인코딩 X, 한글 그대로)
  }
  // ※ 실제 a.href를 만들 때는 encodeURIComponent를 써야 함.
  //   (지금은 리스트에서 텍스트만 보여주므로 표시용은 이대로 충분)

  function summarize(s, n = 160){
    const t = String(s || "").replace(/\\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  }

  function renderVirtual(){
    if(!$list) return;
    const vh = $list.clientHeight || 400;
    const total = filtered.length;
    const scrollTop = $list.scrollTop;
    const start = Math.max(0, Math.floor(scrollTop / rowH) - 5);
    const end = Math.min(total, start + Math.ceil(vh/rowH) + 10);
    const padTop = start * rowH;
    const padBot = (total - end) * rowH;
    const slice = filtered.slice(start, end);

    $list.innerHTML = \`
      <div style="height:\${padTop}px"></div>
      \${slice.map(r=>{
        const f = r.fields || r;
        const id = r.Id || r.id || f.Id || f.id || '';
        const title = f.title || "(untitled)";
        const dateStr = fmtDate(pickDateField(f));
        const isPage = !!(f.is_page || f.Is_page);
        const status = isPage ? "page" : (f.published ? "published" : "draft");
        const link = permalinkOf(f);
        const excerpt = f.excerpt || "";
        const tagsArr = Array.isArray(f.tags) ? f.tags
          : (f.tags ? String(f.tags).split(",").map(s=>s.trim()).filter(Boolean) : []);
        const activeCls = (String(id) === String(STATE.currentId)) ? " active" : "";

        return \`
          <div class="virtual-row\${activeCls}" data-id="\${id}" role="option" aria-label="\${escapeHtml(title)}">
            <div class="vr-title"><strong>\${escapeHtml(title)}</strong></div>
            <div class="vr-meta">\${escapeHtml(dateStr)} \${dateStr ? " • " : ""}\${status}</div>
            \${link ? \`<div class="vr-link">\${escapeHtml(link)}</div>\` : \`\`}
            \${excerpt ? \`<div class="vr-excerpt">\${escapeHtml(summarize(excerpt, 160))}</div>\` : \`\`}
            \${tagsArr.length ? \`<div class="vr-tags">\${tagsArr.map(t=>\`<span class="tag">#\${escapeHtml(t)}</span>\`).join(" ")}</div>\` : \`\`}
          </div>\`;
      }).join("")}
      <div style="height:\${padBot}px"></div>
    \`;
  }

  function setActiveRow(id){
    if(!$list) return;
    $list.querySelectorAll('.virtual-row.active').forEach(el => el.classList.remove('active'));
    if (id==null) return;
    const row = $list.querySelector('.virtual-row[data-id="'+id+'"]');
    if (row) row.classList.add('active');
  }

  $list?.addEventListener('scroll', debounce(renderVirtual, 16));
  $list?.addEventListener('click', (e)=>{
    const row = e.target.closest('.virtual-row'); if(!row) return;
    const id = row.dataset.id;
    openPost(id);
  });

  searchInput?.addEventListener('input', debounce(rebuildFiltered, 200));
  filterSelect?.addEventListener('change', rebuildFiltered);

  // 저장된 뷰
  const VIEWS_KEY = 'editor.savedViews';
  function refreshSavedViews(){
    const list = store.get(VIEWS_KEY, []);
    if (!savedViews) return;
    savedViews.innerHTML = '<option value="">(뷰 선택)</option>' + list.map((v,i)=>'<option value="'+i+'">'+v.name+'</option>').join('');
  }
  saveViewBtn?.addEventListener('click', ()=>{
    const name = prompt('뷰 이름?'); if(!name) return;
    const list = store.get(VIEWS_KEY, []);
    list.push({ name, query: searchInput?.value||'', filter: filterSelect?.value||'all' });
    store.set(VIEWS_KEY, list); refreshSavedViews();
  });
  savedViews?.addEventListener('change', ()=>{
    const idx = Number(savedViews.value);
    const list = store.get(VIEWS_KEY, []);
    const v = list[idx]; if(!v) return;
    if (searchInput) searchInput.value = v.query;
    if (filterSelect) filterSelect.value = v.filter;
    rebuildFiltered();
  });

  async function loadList(){
    if(!$list) return;
    $list.innerHTML = "Loading...";
    const res = await fetch("/api/posts", { headers: headers() });
    if(!res.ok){
      const body = await readTextSafe(res);
      $list.innerHTML = '<div style="color:#c00">API error ('+res.status+')<br><pre style="white-space:pre-wrap;max-height:260px;overflow:auto">'+(body||"").slice(0,2000)+'</pre></div>';
      setHint("API error");
      return;
    }
    const data = await res.json().catch(()=> ({}));
    const rows = data?.list || data?.rows || data?.data || [];
    rows.sort((a, b) => {
      const fa = a.fields || a, fb = b.fields || b;
      const da = new Date(pickDateField(fa) || 0);
      const db = new Date(pickDateField(fb) || 0);
      return db - da; // 최신이 위로
    });
    allPosts = rows;
    refreshSavedViews();
    rebuildFiltered();
    updatePermalink();
    setActiveRow(STATE.currentId);
  }

  // ===== 열기 =====
  async function openPost(id){
    STATE.suspendAutosave = true;
    const res = await fetch(\`/api/posts/\${id}\`, { headers: headers() });
    if(!res.ok){
      const body = await readTextSafe(res);
      setHint("Open error");
      $list && ($list.innerHTML = '<div style="color:#c00">Open error ('+res.status+')<br><pre style="white-space:pre-wrap;max-height:260px;overflow:auto">'+(body||"").slice(0,2000)+'</pre></div>');
      STATE.suspendAutosave = false;
      return;
    }
    const data = await res.json().catch(()=> ({}));
    const f = data.fields || data;
    STATE.currentId = id;
    window.currentPostId = id;

    $("#title").value = f.title || "";
    $("#slug").value = f.slug || "";
    $("#tags").value = Array.isArray(f.tags) ? f.tags.join(", ") : (f.tags || "");
    const ex = document.getElementById("excerpt"); if (ex) ex.value = f.excerpt || "";
    if ($isPage) $isPage.checked = !!(f.is_page || f.Is_page);
    mde.value(f.body_md || f.content || "");

    const parts = isoToParts(f.published_at || f.Published_at || "");
    const pd = document.getElementById("pubdate");
    const pt = document.getElementById("pubtime");
    if (pd) pd.value = parts.date;
    if (pt) pt.value = parts.time;

    if ($publishedToggle) $publishedToggle.checked = !!f.published;

    setStatus(f.published ? "published" : "draft");
    STATE.slugTouched = false;

    STATE.suspendAutosave = false;
    updatePermalink();
    setHint("Loaded");
    setActiveRow(id);
    renderPreviewDeb();
    buildTOCDeb();
    updateMiniMapDeb();
  }
  window.loadPostById = openPost;

  // ===== 첨부 업로드 =====
  async function ensureDraftId() {
    if (STATE.currentId) return STATE.currentId;
    const title = ($("#title").value || "").trim() || "(untitled)";
    const slug  = slugify(($("#slug").value || "").trim() || title);
    const payload = {
      title, slug,
      body_md: mde.value(),
      tags: tagsArr(),
      excerpt: ($("#excerpt")?.value || "").trim(),
      is_page: !!($isPage && $isPage.checked),
      published: false
    };
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify([payload])
    });
    if (!res.ok) throw new Error("draft create failed: " + await readTextSafe(res));
    const data = await res.json().catch(()=> ({}));
    const id =
      data?.[0]?.Id || data?.[0]?.id ||
      data?.rows?.[0]?.Id || data?.rows?.[0]?.id ||
      data?.record?.Id || data?.record?.id ||
      data?.Id || data?.id;
    if (!id) throw new Error("draft id not returned");
    STATE.currentId = id;
    window.currentPostId = id;
    setActiveRow(id);
    return id;
  }

  const attachBtn = document.getElementById("attachBtn");
  const attachInp = document.getElementById("attach");
  if (attachBtn && attachInp) {
    attachBtn.addEventListener("click", () => {
      if (!STATE.key) { alert("Sign in first"); return; }
      attachInp.value = "";
      attachInp.click();
    });

    attachInp.addEventListener("change", async () => {
      const files = Array.from(attachInp.files || []);
      if (!files.length) return;

      if (!STATE.currentId) {
        try { await ensureDraftId(); }
        catch (e) { console.error(e); setHint("초안 생성 실패"); return; }
      }

      const fd = new FormData();
      for (const f of files) fd.append("file", f, f.name);

      setHint("Uploading...");
      const res = await fetch(\`/api/posts/\${encodeURIComponent(STATE.currentId)}/files\`, {
        method: "POST",
        headers: { "x-editor-token": STATE.key },
        body: fd
      });
      const payload = await res.json().catch(()=> ({}));
      if (!res.ok) {
        setHint("Upload error");
        if ($list) {
          $list.innerHTML = '<div style="color:#c00">Upload error ('+res.status+')<br><pre style="white-space:pre-wrap;max-height:260px;overflow:auto">'+JSON.stringify(payload,null,2)+'</pre></div>';
        }
        return;
      }
      const uploaded = Array.isArray(payload?.uploaded) ? payload.uploaded : [];
      for (const u of uploaded) {
        const name = (u?.title || u?.filename || u?.name || "").trim();
        if (!name) continue;
        const mime = (u?.mimetype || u?.type || "").toLowerCase();
        const isImg = mime.startsWith("image/");
        mde.codemirror.replaceSelection((isImg ? "![[" : "[[") + name + "]]\\n");
        mde.codemirror.focus();
      }
      setHint("Uploaded");
    });
  } else {
    console.warn("[editor] attach UI missing");
  }

  // ===== BIBTEX 업로드 (reference.bib로 항상 덮어쓰기 · 이벤트 위임) =====
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest?.('#bibtexBtn');
    if (!btn) return;

    if (!STATE.key) { setHint("Sign in first"); alert("Sign in first"); return; }

    // 인풋 확보(없으면 생성), display:none 방지
    let inp = document.getElementById('bibtexFile') as HTMLInputElement | null;
    if (!inp) {
      inp = document.createElement('input');
      inp.type = 'file';
      inp.id = 'bibtexFile';
      inp.accept = '.bib,text/plain';
      inp.className = 'visually-hidden-file';
      document.body.appendChild(inp);
    } else {
      const st = getComputedStyle(inp);
      if (st.display === 'none') {
        inp.classList.remove('hidden');
        inp.classList.add('visually-hidden-file');
      }
    }

    // 매 클릭마다 1회성 change 핸들러 부착
    const onPick = async () => {
      try {
        const f = inp!.files?.[0];
        if (!f) return;

        const fd = new FormData();
        fd.append('file', f, 'reference.bib'); // 파일명 고정
        fd.append('name', 'reference.bib');

        setHint('Uploading reference.bib...');
        const res = await fetch('/api/upload?overwrite=1', {
          method: 'POST',
          headers: { 'x-editor-token': STATE.key },
          body: fd
        });
        const j = await res.json().catch(() => ({} as any));

        if (!res.ok || j?.ok !== true) {
          console.error('BIBTEX upload failed:', j);
          setHint('BIBTEX upload error');
          alert('업로드 실패: ' + (j?.error || res.status));
          return;
        }

        setHint('BIBTEX uploaded');
        // j.url / j.path 필요하면 여기서 사용 가능
      } catch (err) {
        console.error(err);
        setHint('BIBTEX upload error');
        alert('업로드 에러');
      } finally {
        inp!.value = '';
        inp!.removeEventListener('change', onPick);
      }
    };

    inp.addEventListener('change', onPick, { once: true });
    inp.click();
  });



  // ===== 스티키바: 프리뷰 토글/저장 버튼(스냅샷/통계) =====
  function ensurePreviewShell(){
    if (!$previewFrame) return;
    if ($previewFrame.dataset.ready) return;
    const doc = $previewFrame.contentDocument;
    doc.open();
    doc.write(\`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/assets/style.css"><div id="content" style="padding:14px"></div><script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\\/script><script>window.marked && marked.setOptions({mangle:false, headerIds:false})<\\/script>\`);
    doc.close();
    $previewFrame.dataset.ready = "1";
  }
  async function renderPreview(){
    ensurePreviewShell();
    const doc = $previewFrame?.contentDocument; if(!doc) return;
    const md = mde?.value() || "";

    try {
      const r = await fetch("/api/posts/preview", {
        method: "POST",
        headers: { "content-type":"application/json", "x-editor-token": STATE.key },
        body: JSON.stringify({ md })
      });
      const j = await r.json();
      if (r.ok && j?.ok) {
        doc.getElementById('content').innerHTML = j.html || "";
        return;
      }
    } catch {}

    // 실패하면 클라 렌더 fallback
    const html = (window.marked ? window.marked.parse(md) : md);
    doc.getElementById('content').innerHTML = html;
  }

  const renderPreviewDeb = debounce(renderPreview, 250);

  // ✅ 이벤트 위임: 언제 로드되어도 동작
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element | null)?.closest?.('#previewToggleBtn');
    if (!btn) return;

    const split = document.querySelector('.editor-split') as HTMLElement | null;
    const pane  = document.getElementById('previewPane') as HTMLElement | null;

    const on = !!split?.classList.toggle('show-preview');
    if (pane) pane.hidden = !on;

    (btn as HTMLElement).setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) renderPreview();
  });


  // 읽기 시간/문자 수
  function readingStatFrom(text){
    const chars = text.length;
    const words = (text.match(/\\S+/g)||[]).length;
    const minutes = Math.max(1, Math.round(words/250));
    return \`\${chars}자 · \${minutes}분\`;
  }
  mde?.codemirror.on('change', debounce(()=>{
    if ($readingStats) $readingStats.textContent = readingStatFrom(mde.value()||"");
  }, 300));

  $saveBtn?.addEventListener('click', ()=>save("draft"));
  $publishBtn?.addEventListener('click', ()=>save("published"));
  $publishedToggle?.addEventListener('change', ()=>{
    if(!$publishedToggle) return;
    STATE.status = $publishedToggle.checked ? "published" : "draft";
    $status && ($status.textContent = STATE.status);
  });

  // ===== TOC / 미니맵 =====
  const toc = document.querySelector('.toc-panel');
  function buildTOC(){
    if (!toc) return;
    const md = mde?.value() || "";
    const heads = [...md.matchAll(/^#{1,3}\\s+(.+)$/gm)].map(m => ({ level: (m[0].match(/^#+/)||[''])[0].length, text: m[1], idx: m.index }));
    toc.innerHTML = heads.map(h => '<a data-idx="'+h.idx+'" style="padding-left:'+((h.level-1)*10)+'px">'+h.text+'</a>').join('');
  }
  const buildTOCDeb = debounce(buildTOC, 250);
  mde?.codemirror.on('change', buildTOCDeb);
  buildTOC();

  toc?.addEventListener('click', e=>{
    const a = e.target.closest('a[data-idx]'); if(!a) return;
    const pos = Number(a.dataset.idx)||0;
    const cm = mde.codemirror;
    const doc = cm.getDoc();
    const where = doc.posFromIndex(pos);
    cm.focus(); doc.setCursor(where); cm.scrollIntoView(where, 80);
  });

  const minimap = document.getElementById('miniMap');
  function updateMiniMap(){
    if (!minimap) return;
    const md = mde?.value() || "";
    const heads = [...md.matchAll(/^#{1,3}\\s/gm)].map(m => m.index || 0);
    minimap.innerHTML = '';
    heads.forEach(i=>{
      const y = (i/Math.max(1, md.length)) * 100;
      const dot = document.createElement('div');
      dot.style.position='absolute'; dot.style.left='2px';
      dot.style.top = 'calc('+y+'% - 2px)'; dot.style.width='6px'; dot.style.height='6px';
      dot.style.borderRadius='50%'; dot.style.background='#aaa';
      minimap.appendChild(dot);
    });
  }
  const updateMiniMapDeb = debounce(updateMiniMap, 300);
  mde?.codemirror.on('change', updateMiniMapDeb);
  updateMiniMap();

  // ===== 링크/이미지 간단 체커 =====
  async function checkLinks(){
    const md = mde?.value() || '';
    const links = [...md.matchAll(/\\[([^\\]]+)\\]\\(([^)]+)\\)|!\\[[^\\]]*\\]\\(([^)]+)\\)/g)]
      .map(m => m[2] || m[3]).filter(Boolean);
    const same = links.filter(u=>{ try{ const url=new URL(u,location.href); return url.origin===location.origin }catch{return false} });
    const results = await Promise.all(same.slice(0,20).map(async u=>{
      try{ const r = await fetch(u, { method:'HEAD' }); return {u, ok:r.ok}; } catch { return {u, ok:false} }
    }));
    const bad = results.filter(x=>!x.ok).map(x=>x.u);
    if(bad.length && $saveState) $saveState.textContent = \`깨진 링크 \${bad.length}개\`;
  }
  const checkLinksDeb = debounce(checkLinks, 2000);
  mde?.codemirror.on('change', checkLinksDeb);

  // ===== 단축키: 커맨드 팔레트 =====
  document.addEventListener('keydown', (e)=>{
    if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='k'){ e.preventDefault();
      const cmd = prompt('명령: new / preview / toc / top'); if(!cmd) return;
      if (cmd==='new') document.getElementById('new')?.click();
      if (cmd==='preview') $previewToggleBtn?.click();
      if (cmd==='toc') toc?.scrollIntoView({behavior:'smooth'});
      if (cmd==='top') window.scrollTo({top:0, behavior:'smooth'});
    }
  });

  // ===== 로그아웃 =====
  document.getElementById("signout")?.addEventListener("click", () => {
    try { sessionStorage.removeItem("editor_key"); } catch {}
    STATE.key = "";
    document.body.removeAttribute("data-auth");
    setHint("Signed out");
  });

})();
`;

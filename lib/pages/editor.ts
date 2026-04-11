// lib/pages/editor.ts
// 에디터 HTML 페이지 렌더러 (로그인 후 동적 import 로 부팅)

export type EditorPageOptions = { version?: string };

export function renderEditorHTML(opts: EditorPageOptions = {}): string {
  const ver = opts.version || "v12";
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>Editor</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="mask-icon" href="/favicon.svg" color="#1e2b7a">

<!-- CDN preconnect (DNS + TLS 미리) -->
<link rel="preconnect" href="https://cdnjs.cloudflare.com" crossorigin>
<link rel="preconnect" href="https://unpkg.com" crossorigin>

<!-- 사이트 공통 스타일만 먼저 로드 (로그인 화면 렌더링용) -->
<link rel="stylesheet" href="/assets/style.css">
</head>
<body class="editor-page">

  <!-- 로그인 팝업 오버레이 -->
  <div id="lock">
    <div class="lock-backdrop"></div>
    <div class="lock-panel">
      <h2>Editor</h2>
      <p class="lock-desc">Sign in to manage posts</p>
      <div class="lock-form">
        <input id="key" type="password" placeholder="Password" autofocus />
        <button id="signin">Sign in</button>
      </div>
      <div class="lock-hint" id="lock-hint" aria-live="polite"></div>
    </div>
  </div>

  <!-- 상단 헤더 -->
  <header>
    <a href="/" class="editor-logo">← Blog</a>
    <span id="hint" class="muted" aria-live="polite"></span>
    <div class="editor-header-actions">
      <button class="auth-only" id="new">+ New</button>
    </div>
  </header>

  <!-- 툴바 -->
  <div class="editor-toolbar-sticky auth-only" aria-label="Editor toolbar">
    <button id="sideToggle" type="button" aria-controls="postVirtualList" aria-expanded="true">☰ Posts</button>
    <select id="filterSelect" aria-label="filter">
      <option value="all">All</option>
      <option value="published">Published</option>
      <option value="draft">Draft</option>
      <option value="page">Pages</option>
      <option value="post">Posts</option>
    </select>
    <span class="spacer"></span>
    <button id="previewToggleBtn" type="button" aria-pressed="false">Preview</button>
    <label class="check-inline">
      <input id="publishedToggle" type="checkbox"><span>Published</span>
    </label>
  </div>

  <div class="wrap">
    <div class="editor-layout">
      <!-- 좌측 목록 -->
      <aside class="editor-side side" aria-label="posts panel">
        <div class="side-head">
          <input id="searchInput" type="text" aria-label="Search posts" placeholder="제목/태그 검색…" />
        </div>
        <div id="postVirtualList" class="virtual-list" role="listbox" aria-label="posts list"></div>
      </aside>

      <div class="side-backdrop" id="sideBackdrop" aria-hidden="true"></div>
      <div class="editor-main">
        <section class="editor-split">
          <main class="editor pad-12">
            <div class="editor-actions-bar">
              <div class="editor-actions-left">
                <label class="check-inline"><input id="is_page" type="checkbox"><span>Page</span></label>
                <span id="permalink" class="muted small nowrap">Permalink: /post/</span>
                <span id="status">draft</span>
              </div>
              <div class="editor-actions-right">
                <button class="auth-only" id="save">Save</button>
                <button class="auth-only btn-danger" id="delete">Delete</button>
                <button class="auth-only btn-ghost" id="attachBtn">Image</button>
                <input id="attach" type="file" multiple accept="image/*" class="hidden" />
                <button type="button" class="auth-only btn-ghost" id="bibtexBtn">BibTeX</button>
                <input id="bibtexFile" type="file" accept=".bib,text/plain" class="hidden" />
                <button type="button" class="auth-only btn-ghost" id="transcriptBtn">Transcript</button>
              </div>
            </div>

            <div class="editor-fields">
              <input id="title" type="text" placeholder="Title" class="field-title" />
              <div class="editor-fields-row">
                <input id="slug" type="text" placeholder="Slug (auto)" />
                <div class="tags-multiselect" id="tagsMulti">
                  <div class="tags-chips" id="tagsChips"></div>
                  <input id="tagsInput" type="text" placeholder="Add tag..." autocomplete="off" />
                  <div class="tags-suggestions" id="tagsSuggestions" hidden></div>
                </div>
                <input id="tags" type="hidden" />
              </div>
              <input id="excerpt" type="text" placeholder="Excerpt (auto if empty)" />
              <div class="editor-fields-row">
                <input id="pubdate" type="date" />
                <input id="pubtime" type="time" />
              </div>
            </div>

            <textarea id="md"></textarea>
          </main>

          <aside id="previewPane" class="preview-pane" hidden>
            <iframe id="previewFrame" title="미리보기"></iframe>
          </aside>
        </section>

        <aside class="editor-extras">
          <nav class="toc-panel" aria-label="document outline"></nav>
        </aside>
      </div>
    </div>
  </div>

  <!-- 인증 & 부트스트랩 -->
  <script type="module">
    const $ = (s) => document.querySelector(s);

    function setToken(tok){
      try { localStorage.setItem("editor_token", tok); } catch {}
      document.cookie = "editor_token=" + encodeURIComponent(tok) + "; Path=/; Max-Age=" + (60*60*24*7) + "; SameSite=Lax; Secure";
    }
    function getToken(){
      try { const t = localStorage.getItem("editor_token"); if (t) return t; } catch {}
      const m = document.cookie.match(/(?:^|;\\s*)editor_token=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    }
    async function checkKey(tok){
      if (!tok) return false;
      try {
        const r = await fetch("/api/check-key", { headers: { "x-editor-token": tok }});
        const j = await r.json().catch(()=>({}));
        return r.ok && j && j.ok === true;
      } catch { return false; }
    }

    // 외부 리소스를 병렬로 지연 로드 (로그인 성공 후에만)
    function loadStylesheet(href){
      return new Promise((resolve, reject) => {
        if (document.querySelector('link[href="'+href+'"]')) return resolve(null);
        const l = document.createElement("link");
        l.rel = "stylesheet";
        l.href = href;
        l.onload = () => resolve(null);
        l.onerror = reject;
        document.head.appendChild(l);
      });
    }
    function loadScript(src){
      return new Promise((resolve, reject) => {
        if (document.querySelector('script[src="'+src+'"]')) return resolve(null);
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve(null);
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }

    // 로그인 성공 → 필요한 외부 리소스 병렬 로드 → editor.js 부팅
    let __booted = false;
    async function bootEditor(){
      if (__booted) return; __booted = true;
      const hint = $("#hint");
      try {
        // 외부 리소스를 모두 병렬 로드 (이전에는 HTML head에서 blocking 로드)
        await Promise.all([
          loadStylesheet("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css"),
          loadStylesheet("https://unpkg.com/easymde/dist/easymde.min.css"),
          loadScript("https://unpkg.com/easymde/dist/easymde.min.js"),
        ]);

        const mod = await import("/assets/editor.js?ts=" + Date.now());
        const init = (mod && (mod.initEditor || mod.default)) || (window.initEditor);
        if (typeof init === "function") {
          await init();
          document.body.classList.add("editor-ready");
          if (hint) hint.textContent = "";
        } else {
          if (hint) hint.textContent = "editor.js: init 함수를 찾을 수 없습니다.";
          console.warn("editor.js init not found. Export initEditor() or default.");
        }
      } catch (e) {
        console.error("Editor boot failed:", e);
        if (hint) hint.textContent = "에디터 초기화 실패: " + (e && e.message ? e.message : e);
      }
    }

    async function requireAuth(){
      const lock = $("#lock");
      const input = $("#key");
      const btn   = $("#signin");
      const hint  = $("#lock-hint");

      // 자동 시도
      const existing = getToken();
      if (await checkKey(existing)) {
        if (lock) lock.style.display = "none";
        document.body.classList.add("authed");
        document.body.dataset.auth = "1";
        await bootEditor();
        return;
      }

      // 수동 로그인
      if (lock) lock.style.display = "";
      document.body.classList.remove("authed");
      delete document.body.dataset.auth;

      async function submit(){
        const tok = input && input.value ? String(input.value).trim() : "";
        if (!tok) { if (hint) hint.textContent = "비밀번호를 입력하세요."; return; }
        if (hint) hint.textContent = "확인 중…";
        const ok = await checkKey(tok);
        if (ok){
          setToken(tok);
          if (hint) hint.textContent = "";
          if (lock) lock.style.display = "none";
          document.body.classList.add("authed");
          document.body.dataset.auth = "1";
          await bootEditor();
        } else {
          if (hint) hint.textContent = "비밀번호가 올바르지 않습니다.";
          if (input && input.select) input.select();
        }
      }

      if (btn) btn.addEventListener("click", (e)=>{ e.preventDefault(); submit(); });
      if (input) input.addEventListener("keydown", (e)=>{ if (e.key === "Enter"){ e.preventDefault(); submit(); }});
    }

    window.addEventListener("DOMContentLoaded", requireAuth);
  </script>

  <!-- 모바일 사이드바 토글 -->
  <script type="module">
  (function(){
    const side   = document.querySelector('.editor-side');
    const btn    = document.getElementById('sideToggle');
    const bd     = document.getElementById('sideBackdrop');
    const mq     = window.matchMedia('(max-width: 900px)');
    const isM    = () => mq.matches;

    function setMobileOpen(on){
      document.body.classList.toggle('side-open', on);
      btn?.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on && isM()) document.body.classList.add('no-scroll');
      else document.body.classList.remove('no-scroll');
    }

    function setCollapsed(collapsed){
      // 데스크탑: 목록 접기/펼치기
      document.body.classList.toggle('side-collapsed', collapsed);
      // 접혀 있으면 '목록 패널이 닫혀있다' → expanded=false
      btn?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    function handleClick(){
      if (isM()) {
        const on = !document.body.classList.contains('side-open');
        setMobileOpen(on);
      } else {
        const collapsed = !document.body.classList.contains('side-collapsed');
        setCollapsed(collapsed);
      }
    }

    btn?.addEventListener('click', (e)=>{ e.preventDefault(); handleClick(); });
    bd?.addEventListener('click', ()=> setMobileOpen(false));
    document.addEventListener('keydown', (e)=>{ if (e.key === 'Escape') setMobileOpen(false); });
    mq.addEventListener?.('change', ()=>{
      if (isM()) {
        // 모바일로 진입하면 데스크탑용 '접힘' 상태를 반드시 해제해야
        // overlay 토글이 정상 동작함.
        document.body.classList.remove('side-collapsed');
        setMobileOpen(false); // 기본은 닫힌 상태
      } else {
        // 데스크탑으로 돌아갈 때도 모바일 오버레이는 정리
        setMobileOpen(false);
      }
      initExpandedState();
    });
  })();
</script>
</body>
</html>`;
}

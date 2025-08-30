// lib/pages/editor.ts
// 에디터 HTML 페이지 렌더러 (로그인 후 동적 import 로 부팅)

export type EditorPageOptions = { version?: string };

export function renderEditorHTML(opts: EditorPageOptions = {}): string {
  const ver = opts.version || "v12";
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Editor</title>

<!-- EasyMDE가 필요로 하는 Font Awesome 4 아이콘 + EasyMDE 자체 -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">
<link rel="stylesheet" href="https://unpkg.com/easymde/dist/easymde.min.css">
<script src="https://unpkg.com/easymde/dist/easymde.min.js"></script>

<!-- 사이트 공통 스타일 -->
<link rel="stylesheet" href="/assets/style.css">
</head>
<body class="editor-page">
  <!-- 로그인 오버레이 -->
  <div id="lock">
    <div class="panel">
      <h2>Editor 로그인</h2>
      <div class="row row-wrap">
        <input id="key" type="password" placeholder="Editor password" />
        <button id="signin">Sign in</button>
      </div>
      <div class="hint" id="lock-hint" aria-live="polite"></div>
    </div>
  </div>

  <!-- 상단 헤더 -->
  <header class="editor-header">
    <button class="auth-only" id="new">New</button>
    <span id="hint" class="muted" aria-live="polite"></span>
    <a href="/" class="link-back" data-back>← 목록</a>
  </header>

  <!-- 툴바(필터/프리뷰/Published 토글) -->
  <div class="editor-toolbar-sticky auth-only" aria-label="Editor toolbar">
    <button id="sideToggle" type="button" aria-controls="postVirtualList" aria-expanded="true">☰ 목록</button>
    <select id="filterSelect" aria-label="filter">
      <option value="all">all</option>
      <option value="published">published</option>
      <option value="draft">draft</option>
      <option value="page">page</option>
      <option value="post">post</option>
    </select>
    <span class="spacer"></span>
    <button id="previewToggleBtn" type="button" aria-pressed="false" title="미리보기 토글">Preview</button>
    <label class="check-inline">
      <input id="publishedToggle" type="checkbox"><span>published</span>
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
            <!-- ⬇ 같은 줄: page 체크 + Permalink + status + (Save/Delete/이미지) -->
            <div class="row row-wrap" style="align-items:center; gap:10px;">
              <label class="check-inline">
                <input id="is_page" type="checkbox"><span>page</span>
              </label>
              <span id="permalink" class="muted small nowrap">Permalink: /post/</span>
              <span id="status" class="muted small" style="margin-left:auto">draft</span>

              <!-- 액션 버튼들(같은 줄, 오른쪽 정렬) -->
              <div class="row-actions" style="display:flex; gap:8px; margin-left:12px;">
                <button class="auth-only" id="save">Save</button>
                <button class="auth-only" id="delete">Delete</button>
                <button class="auth-only" id="attachBtn">이미지</button>
                <input id="attach" type="file" multiple accept="image/*" class="hidden" />
              </div>
            </div>

            <div class="row row-wrap">
              <input id="title" type="text" placeholder="Title" />
              <input id="slug"  type="text" placeholder="Slug(자동)" />
              <input id="tags"  type="text" placeholder="쉼표로 여러 태그 입력 (예: diary, reading, test)" />
            </div>

            <div class="row">
              <input id="excerpt" type="text" placeholder="Excerpt (목록에 보일 요약 — 비워두면 본문에서 자동 발췌)" />
            </div>

            <div class="row row-gap">
              <label class="small muted">Publish date</label>
              <input id="pubdate" type="date" />
              <label class="small muted">time</label>
              <input id="pubtime" type="time" />
              <span class="small faint">(Published 토글이 켜져 있을 때만 적용)</span>
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

    // 로그인 성공 → /assets/editor.js 동적 import → initEditor()
    let __booted = false;
    async function bootEditor(){
      if (__booted) return; __booted = true;
      const hint = $("#hint");
      try {
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

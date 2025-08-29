// lib/pages/editor.ts
// 에디터 HTML 페이지 렌더러 (로그인 후 동적 import 로 부팅)

export type EditorPageOptions = { version?: string };

export function renderEditorHTML(opts: EditorPageOptions = {}): string {
  const ver = opts.version || "v12"; // 캐시 버스터
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Editor</title>
<link rel="stylesheet" href="https://unpkg.com/easymde/dist/easymde.min.css">
<link rel="stylesheet" href="/assets/style.css">
<style>
  /* 기본: 숨김 */
  .auth-only { display: none; }
  /* 로그인 후: 확실히 보이게 !important */
  body.authed .auth-only { display: inline-flex !important; }

  /* 로그인 오버레이 */
  #lock{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);z-index:1000}
  #lock .panel{background:#fff;padding:16px 18px;border-radius:10px;min-width:280px;box-shadow:0 8px 30px rgba(0,0,0,.25)}
  #lock .row{display:flex;gap:8px}
  #lock .hint{margin-top:8px;font-size:12px;opacity:.8}

  /* 폴백: 에디터 초기화 실패해도 textarea는 보이게 */
  #md{display:block; min-height:320px}
</style>
</head>
<body class="editor-page">
  <!-- 로그인 오버레이 -->
  <div id="lock" style="display:none">
    <div class="panel">
      <h2>Editor 로그인</h2>
      <div class="row">
        <input id="key" type="password" placeholder="Editor password" />
        <button id="signin">Sign in</button>
      </div>
      <div class="hint" id="lock-hint" aria-live="polite"></div>
    </div>
  </div>

  <!-- 상단 헤더 (로그인 후 보임) -->
  <header>
    <button class="auth-only" id="new">New</button>
    <button class="auth-only" id="save">Save Draft</button>
    <button class="auth-only" id="publish">Publish</button>
    <button class="auth-only" id="delete">Delete</button>
    <button class="auth-only" id="attachBtn">이미지</button>
    <input id="attach" type="file" multiple accept="image/*" style="display:none" />
    <span id="hint" style="opacity:.8;font-size:13px;margin-left:8px"></span>
    <a href="/" style="margin-left:auto;opacity:.8" data-back>← 목록</a>
  </header>

  <!-- 툴바 (로그인 후 보임) -->
  <div class="editor-toolbar-sticky auth-only" aria-label="Editor toolbar">
    <button id="sideToggle" class="only-mobile" type="button" aria-controls="postVirtualList" aria-expanded="false">☰ 목록</button>
    <select id="filterSelect" aria-label="filter">
      <option value="all">all</option>
      <option value="published">published</option>
      <option value="draft">draft</option>
      <option value="page">page</option>
      <option value="post">post</option>
    </select>
    <span class="spacer" style="flex:1"></span>
    <button id="previewToggleBtn" type="button" aria-pressed="false" title="미리보기 토글">Preview</button>
    <label style="display:inline-flex;align-items:center;gap:6px">
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
      <div class="resize-handle" aria-hidden="true"></div>

      <div class="editor-main">
        <section class="editor-split">
          <main class="editor" style="padding:12px">
            <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:6px;white-space:nowrap">
                <input id="is_page" type="checkbox"><span>page</span>
              </label>
              <span id="permalink" style="font-size:12px;opacity:.75;white-space:nowrap">Permalink: /post/</span>
              <span id="status" style="opacity:.8;font-size:13px;margin-left:auto">draft</span>
            </div>

            <div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">
              <input id="title" type="text" placeholder="Title" />
              <input id="slug" type="text" placeholder="Slug(자동)" />
              <input id="tags" type="text" placeholder="쉼표로 여러 태그 입력 (예: diary, reading, test)" />
            </div>

            <div class="row">
              <input id="excerpt" type="text" placeholder="Excerpt (목록에 보일 요약 — 비워두면 본문에서 자동 발췌)" />
            </div>

            <div class="row" style="gap:10px">
              <label style="font-size:12px;opacity:.8">Publish date</label>
              <input id="pubdate" type="date" />
              <label style="font-size:12px;opacity:.8">time</label>
              <input id="pubtime" type="time" />
              <span style="font-size:12px;opacity:.6">(Publish 때만 적용)</span>
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

  <!-- EasyMDE (전역) -->
  <script src="https://unpkg.com/easymde/dist/easymde.min.js"></script>

  <!-- 로마자 모듈 프리로드 -->
  <script type="module">
    (async () => {
      try {
        const mod = await import("https://esm.sh/korean-romanization");
        const romanize = (mod && (mod.romanize || mod.default));
        if (typeof romanize === "function") {
          // @ts-ignore
          window.__romanize = romanize;
          window.dispatchEvent(new CustomEvent("romanize-loaded"));
        }
      } catch (e) { console.warn("romanization preload failed", e); }
    })();
  </script>

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
        console.debug("[editor] check-key:", r.status, j);
        return r.ok && j && j.ok === true;
      } catch (e) {
        console.warn("[editor] check-key fail:", e);
        return false;
      }
    }

    // 로그인 성공 후 editor.js를 동적 import → initEditor() 실행
    let __booted = false;
    async function bootEditor(){
      if (__booted) return; __booted = true;
      const hint = $("#hint");
      try {
        const mod = await import("/assets/editor.js?v=${ver}");
        const init = mod && (mod.initEditor || mod.default) || (window.initEditor || (window.EditorApp && window.EditorApp.init));
        if (typeof init === "function") {
          console.debug("[editor] initEditor start");
          await init();
          console.debug("[editor] initEditor done");
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
      const input= $("#key");
      const btn  = $("#signin");
      const hint = $("#lock-hint");

      // 자동 시도
      const existing = getToken();
      if (await checkKey(existing)) {
        console.debug("[editor] authed via existing token");
        if (lock) lock.style.display = "none";
        document.body.classList.add("authed"); // <- 메뉴 보이게
        await bootEditor();
        return;
      }

      // 수동 로그인
      if (lock) lock.style.display = "";
      document.body.classList.remove("authed");
      async function submit(){
        const tok = (input && (input as HTMLInputElement).value) ? String((input as HTMLInputElement).value).trim() : "";
        if (!tok) { if (hint) hint.textContent = "비밀번호를 입력하세요."; return; }
        if (hint) hint.textContent = "확인 중…";
        if (await checkKey(tok)){
          setToken(tok);
          if (hint) hint.textContent = "";
          if (lock) lock.style.display = "none";
          document.body.classList.add("authed"); // <- 메뉴 보이게
          await bootEditor();
        } else {
          if (hint) hint.textContent = "비밀번호가 올바르지 않습니다.";
          (input as HTMLInputElement)?.select?.();
        }
      }
      btn?.addEventListener("click", (e)=>{ e.preventDefault(); submit(); });
      input?.addEventListener("keydown", (e)=>{ if (e.key === "Enter"){ e.preventDefault(); submit(); }});
    }

    window.addEventListener("DOMContentLoaded", requireAuth);
  </script>

  <!-- 모바일 사이드바 토글 -->
  <script type="module">
    (function(){
      const side=document.querySelector('.editor-side');
      const btn=document.getElementById('sideToggle');
      const bd=document.getElementById('sideBackdrop');
      if (!side||!btn||!bd) return;
      const mq=window.matchMedia('(max-width: 900px)'); const isM=()=>mq.matches;
      function open(){ document.body.classList.add('side-open'); btn.setAttribute('aria-expanded','true'); if(isM()) document.body.classList.add('no-scroll'); }
      function close(){ document.body.classList.remove('side-open','no-scroll'); btn.setAttribute('aria-expanded','false'); }
      btn.addEventListener('click',(e)=>{ e.preventDefault(); document.body.classList.contains('side-open')?close():open(); });
      bd.addEventListener('click', close);
      document.addEventListener('keydown',(e)=>{ if(e.key==='Escape') close(); });
      side.addEventListener('click',(e)=>{ const t=e.target; const row=t && (t as HTMLElement).closest ? (t as HTMLElement).closest('.virtual-row') : null; if(row && isM()) setTimeout(close,0); });
      mq.addEventListener?.('change',()=>{ if(!isM()) close(); });
      window.addEventListener('resize',()=>{ if(!isM()) close(); });
    })();
  </script>

  <!-- 이미지 업로드 → 본문 삽입 -->
  <script type="module">
    function token(){ try{const t=localStorage.getItem("editor_token"); if(t) return t;}catch{} const m=document.cookie.match(/(?:^|;\\s*)editor_token=([^;]+)/); return m?decodeURIComponent(m[1]):""; }
    async function uploadImage(file){
      const t = token();
      if (!t) throw new Error("에디터 토큰이 없습니다. 먼저 로그인하세요.");
      const fd = new FormData(); fd.set("file", file);
      const r = await fetch("/api/upload", { method:"POST", body:fd, headers:{ "x-editor-token": t }});
      const j = await r.json().catch(()=>({})); if (!r.ok || !j || !j.url) throw new Error((j && j.error) || "upload failed"); return j.url;
    }
    function insertAtCursor(ta, text){
      const s = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
      const e = ta.selectionEnd   != null ? ta.selectionEnd   : ta.value.length;
      const before=ta.value.slice(0,s), after=ta.value.slice(e);
      ta.value = before + text + after;
      const pos = s + text.length;
      ta.setSelectionRange && ta.setSelectionRange(pos,pos);
      ta.dispatchEvent(new Event("input",{bubbles:true}));
    }
    window.addEventListener("DOMContentLoaded", function(){
      const btn=document.getElementById("attachBtn") as HTMLButtonElement | null;
      const input=document.getElementById("attach") as HTMLInputElement | null;
      const ta=document.getElementById("md") as HTMLTextAreaElement | null;
      const hint=document.getElementById("hint");
      if (!btn||!input||!ta) return;
      btn.addEventListener("click", ()=>{ input && (input as any).click && (input as any).click(); });
      input.addEventListener("change", async ()=>{
        const files = input.files ? Array.from(input.files) : [];
        if (!files.length) return;
        try {
          const urls=[]; for (let i=0;i<files.length;i++){ urls.push(await uploadImage(files[i])); }
          insertAtCursor(ta, urls.map(u => "![](" + u + ")").join("\\n\\n"));
          if (hint) hint.textContent = "이미지 " + urls.length + "개 첨부됨.";
        } catch(e){
          if (hint) hint.textContent = "이미지 업로드 실패: " + (e && (e as any).message ? (e as any).message : String(e));
          console.error(e);
        } finally {
          input.value = "";
          setTimeout(()=>{ if (hint) hint.textContent=""; }, 4000);
        }
      });
    });
  </script>

</body>
</html>`;
}

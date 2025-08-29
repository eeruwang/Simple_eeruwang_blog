// lib/pages/editor.ts
// 에디터 HTML 페이지 렌더러 (런타임 불문 재사용)
// - 정적 클라이언트 스크립트: /assets/editor.js
// - 전역 스타일: /style.css

export type EditorPageOptions = {
  version?: string; // 캐시 버스터
};

export function renderEditorHTML(opts: EditorPageOptions = {}): string {
  const ver = opts.version || "v8";
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Editor</title>
<link rel="stylesheet" href="https://unpkg.com/easymde/dist/easymde.min.css">
<link rel="stylesheet" href="/assets/style.css">
</head>
<body class="editor-page">
  <div id="lock">
    <div class="panel">
      <h2>Editor 로그인</h2>
      <div class="row">
        <input id="key" type="password" placeholder="Editor password" />
        <button id="signin">Sign in</button>
      </div>
      <div class="hint" id="lock-hint"></div>
    </div>
  </div>

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
      <input id="publishedToggle" type="checkbox">
      <span>published</span>
    </label>
  </div>

  <div class="wrap">
    <div class="editor-layout">
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

  <script src="https://unpkg.com/easymde/dist/easymde.min.js"></script>

  <!-- 로마자 모듈 사전 로드 -->
  <script type="module">
    (async function(){
      try {
        const mod = await import("https://esm.sh/korean-romanization");
        const romanize = (mod && (mod.romanize || mod.default));
        if (typeof romanize === "function") {
          window.__romanize = romanize;
          window.dispatchEvent(new CustomEvent("romanize-loaded"));
        }
      } catch (e) {
        console.warn("romanization preload failed", e);
      }
    })();
  </script>

  <!-- 모바일 사이드바 오버레이 토글 (순수 JS) -->
  <script type="module">
    (function(){
      const side     = document.querySelector('.editor-side');
      const toggleBtn= document.getElementById('sideToggle');
      const backdrop = document.getElementById('sideBackdrop');
      if (!side || !toggleBtn || !backdrop) return;

      const mq = window.matchMedia('(max-width: 900px)');
      const isMobile = () => mq.matches;

      function openSide() {
        document.body.classList.add('side-open');
        toggleBtn.setAttribute('aria-expanded', 'true');
        if (isMobile()) document.body.classList.add('no-scroll');
      }
      function closeSide() {
        document.body.classList.remove('side-open','no-scroll');
        toggleBtn.setAttribute('aria-expanded', 'false');
      }
      function toggleSide() {
        if (document.body.classList.contains('side-open')) closeSide();
        else openSide();
      }

      toggleBtn.addEventListener('click', function(e){ e.preventDefault(); toggleSide(); });
      backdrop.addEventListener('click', closeSide);
      document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeSide(); });

      side.addEventListener('click', function(e){
        const t = e.target;
        if (t && typeof t.closest === 'function') {
          const row = t.closest('.virtual-row');
          if (row && isMobile()) setTimeout(closeSide, 0);
        }
      });

      if (mq.addEventListener) mq.addEventListener('change', function(){ if (!isMobile()) closeSide(); });
      window.addEventListener('resize', function(){ if (!isMobile()) closeSide(); });
    })();
  </script>

  <!-- 이미지 업로드 → 본문 삽입 (순수 JS) -->
  <script type="module">
    function getToken() {
      return localStorage.getItem("editor_token") || "";
    }
    async function uploadImage(file) {
      const token = getToken();
      if (!token) throw new Error("에디터 토큰이 없습니다. 먼저 로그인하세요.");
      const fd = new FormData();
      fd.set("file", file);
      const r = await fetch("/api/upload", {
        method: "POST",
        body: fd,
        headers: { "x-editor-token": token }
      });
      const j = await r.json().catch(function(){ return {}; });
      if (!r.ok || !j || !j.url) throw new Error((j && j.error) || "upload failed");
      return j.url;
    }
    function insertAtCursor(textarea, text) {
      var start = textarea.selectionStart != null ? textarea.selectionStart : textarea.value.length;
      var end   = textarea.selectionEnd   != null ? textarea.selectionEnd   : textarea.value.length;
      var before= textarea.value.slice(0, start);
      var after = textarea.value.slice(end);
      textarea.value = before + text + after;
      var pos = start + text.length;
      if (textarea.setSelectionRange) textarea.setSelectionRange(pos, pos);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }

    window.addEventListener("DOMContentLoaded", function() {
      var btn = document.getElementById("attachBtn");
      var input = document.getElementById("attach");
      var ta = document.getElementById("md");
      if (!btn || !input || !ta) return;

      btn.addEventListener("click", function(){ (input as any).click && (input as any).click(); });
      input.addEventListener("change", async function() {
        var files = Array.prototype.slice.call((input as any).files || []);
        if (!files.length) return;
        try {
          var urls = [];
          for (var i=0;i<files.length;i++) {
            var url = await uploadImage(files[i]);
            urls.push(url);
          }
          var md = urls.map(function(u){ return "![](" + u + ")"; }).join("\\n\\n");
          insertAtCursor(ta as any, md);
        } catch (e) {
          alert("이미지 업로드 실패: " + (e && e.message ? e.message : e));
          console.error(e);
        } finally {
          (input as any).value = "";
        }
      });
    });
  </script>

  <script src="/assets/editor.js?v=${ver}"></script>
</body></html>`;
}
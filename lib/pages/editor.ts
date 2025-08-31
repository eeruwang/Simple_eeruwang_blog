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
<link rel="stylesheet" href="https://unpkg.com/easymde/dist/easymde.min.css" crossorigin="anonymous">
<script src="https://unpkg.com/easymde/dist/easymde.min.js" crossorigin="anonymous"></script>

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
    <!-- ↓ display:none 쓰지 않기 -->
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
                <button type="button" class="auth-only" id="bibtexBtn" title="Upload reference.bib">BIBTEX</button>
                <input id="bibtexFile" type="file" accept=".bib,text/plain" class="hidden" />

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
  <!-- 인증 & 부트스트랩 & (모듈 엔트리)-->
  <script type="module" src="/assets/editor/index.js" defer></script>
</body>
</html>`;
}

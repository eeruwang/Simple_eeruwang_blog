// public/assets/press.js
(function () {
  // 현재 경로가 포스트 or 페이지인지 판정 + slug 추출
  function detectSlug() {
    const p = location.pathname.replace(/\/+$/, "");
    if (p.startsWith("/post/")) return decodeURIComponent(p.slice("/post/".length));
    // 단일 세그먼트 페이지(/about 같은) — 예약 경로 제외
    const segs = p.split("/").filter(Boolean);
    if (segs.length === 1) {
      const s = segs[0];
      const reserved = ["api", "assets", "post", "tag", "editor", "rss.xml", "favicon", "robots.txt", "sitemap.xml"];
      if (!reserved.includes(s)) return decodeURIComponent(s);
    }
    return null;
  }

  // 매우 작은 마크다운 파서 (CDN 없이도 최소 렌더되게)
  function tinyMd(md) {
    if (!md) return "";
    let h = md;
    h = h.replace(/```([\s\S]*?)```/g, function (_m, code) {
      const esc = String(code).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
      return "<pre><code>" + esc + "</code></pre>";
    });
    h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    h = h.replace(/^(#{1,6})\s*(.+)$/gm, function (_m, sharp, text) {
      var lvl = Math.min(6, sharp.length);
      return "<h" + lvl + ">" + text + "</h" + lvl + ">";
    });
    h = h.split(/\n{2,}/).map(function (p) {
      return (/^\s*<(h\d|pre|ul|ol|blockquote|table|img|p|figure|div)\b/i.test(p) ? p : "<p>" + p + "</p>");
    }).join("\n");
    return h;
  }

  async function run() {
    const slug = detectSlug();
    if (!slug) return; // 메인(/)이나 /tag/* 에서는 아무 것도 하지 않음

    const wrap = document.getElementById("content") || document.querySelector("[data-content]");
    if (!wrap) return;

    // 공개 단건 API에서 본문 가져오기 (본문은 1번에서 보장해야 함)
    try {
      const r = await fetch("/api/posts?slug=" + encodeURIComponent(slug), { headers: { "cache-control": "no-store" } });
      if (!r.ok) return;
      const j = await r.json().catch(() => null);
      const item = j && (j.item || j.record || j.fields || j);
      const md = item && (item.body_md || item.content || "");

      // marked가 있으면 사용, 아니면 tinyMd 사용
      let html = "";
      if (window.marked && typeof window.marked.parse === "function") {
        window.marked.setOptions && window.marked.setOptions({ mangle: false, headerIds: false });
        html = window.marked.parse(md || "");
      } else {
        html = tinyMd(md || "");
      }

      // 본문 주입
      // md가 비면 아무 것도 하지 않음
      if (!md || /^\s*$/.test(md)) return;
      // 서버가 이미 본문을 렌더해둔 경우(초기 SSR) 덮어쓰지 않음
      if (wrap && wrap.innerHTML && !/^\s*$/.test(wrap.innerHTML)) return;
      // 정말 비어 있을 때에만 주입
      if (!wrap.innerHTML.trim()) wrap.innerHTML = html;
      // 뒤로가기 링크(data-back) 처리(외부 파일에서 이벤트 등록)
      // 인라인 스크립트 없이도 동작하도록 여기서 위임
      document.addEventListener("click", function (e) {
        var a = e.target && e.target.closest && e.target.closest("[data-back]");
        if (!a) return;
        if (history.length > 1) { e.preventDefault(); history.back(); }
      }, { passive: false });
    } catch (e) {
      console.warn("[press] render failed:", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();

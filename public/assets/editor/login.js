// public/assets/editor/login.js
import * as auth from "/assets/editor/auth.js";
auth.wireLoginUI();

let loaded = false;
async function loadApp() {
  if (loaded) return;
  loaded = true;
  await import(`/editor/asset/index.js?v=${Date.now()}`); // 비공개 본편
}

// 이미 로그인돼 있으면 바로 로드
if (document.body.dataset.auth === "1") loadApp();
// 로그인 성공(data-auth가 1로 변할 때) 감지해 로드
new MutationObserver(() => {
  if (document.body.dataset.auth === "1") loadApp();
}).observe(document.body, { attributes:true, attributeFilter:["data-auth"] });

// 1) 뒤로가기 링크(data-back) 바인딩
(function () {
  function bindBackLink() {
    var a = document.querySelector('[data-back]');
    if (!a) return;
    a.addEventListener('click', function (e) {
      if (history.length > 1) { e.preventDefault(); history.back(); }
    }, { passive: false });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindBackLink, { once: true });
  } else {
    bindBackLink();
  }
})();

// 2) (옵션) lazy 이미지 하이드레이션: data-src/srcset → src/srcset
(function () {
  function hydrateImages() {
    document.querySelectorAll('img[data-src]').forEach(img => {
      img.setAttribute('src', img.getAttribute('data-src'));
      img.removeAttribute('data-src');
    });
    document.querySelectorAll('source[data-srcset]').forEach(s => {
      s.setAttribute('srcset', s.getAttribute('data-srcset'));
      s.removeAttribute('data-srcset');
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hydrateImages, { once: true });
  } else {
    hydrateImages();
  }
})();

// 3) 본문 주입 Fallback (#content가 비었을 때만 API로 채움)
(function () {
  function mdToHtml(md) {
    if (!md) return "";
    // 최소 변환 (body_html이 있으면 그걸 우선 사용하므로 백업용)
    let h = md;
    h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">'); // 이미지
    h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');     // 링크
    h = h.split(/\n{2,}/).map(p => `<p>${p}</p>`).join("\n");             // 문단
    return h;
  }

  async function hydratePost() {
    const el = document.getElementById("content");
    if (!el) return;
    // 이미 서버/다른 코드가 채웠다면 건드리지 않음
    if (el.children.length || (el.textContent || "").trim()) return;

    const m = location.pathname.match(/^\/post\/([^/?#]+)/);
    if (!m) return;
    const slug = decodeURIComponent(m[1]);

    try {
      const r = await fetch("/api/posts?slug=" + encodeURIComponent(slug), { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      const item = Array.isArray(j?.items) ? j.items[0] : j;
      if (!item) return;
      el.innerHTML = item.body_html || mdToHtml(item.body_md || "");
    } catch (e) {
      console.error("hydratePost failed:", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", hydratePost, { once: true });
  } else {
    hydratePost();
  }
})();

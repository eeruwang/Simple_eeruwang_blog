// public/assets/site.js
(() => {
  const open  = () => document.body.classList.add("side-open");
  const close = () => document.body.classList.remove("side-open");
  const toggle = () => document.body.classList.toggle("side-open");

  // 버튼/백드롭 클릭으로 제어
  document.addEventListener("click", (e) => {
    const t = e.target.closest?.('[data-side-open],[data-side-close],[data-side-toggle],#sideBackdrop');
    if (!t) return;
    if (t.id === "sideBackdrop" || t.hasAttribute("data-side-close")) return close();
    if (t.hasAttribute("data-side-open")) return open();
    if (t.hasAttribute("data-side-toggle")) return toggle();
  });

  // ESC 로 닫기
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  // 필요시 전역 노출
  window.SidePanel = { open, close, toggle };

  // /public/assets/site.js 또는 /public/assets/press.js에 추가
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

})();

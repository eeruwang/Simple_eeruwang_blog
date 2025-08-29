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
})();

/* Transition: #page only */

(function(){
  function $page(){ return document.getElementById('page'); }
  function enter(){ requestAnimationFrame(()=> $page() && $page().classList.add('ready')); }
  if (document.readyState === "complete" || document.readyState === "interactive") enter();
  else document.addEventListener("DOMContentLoaded", enter, { once:true });
  setTimeout(()=>{ if(!$page()?.classList.contains('ready')) enter(); }, 150);

  document.addEventListener("click", function(e){
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    if (a.closest && a.closest("#tagrail")) return;
    if (a.matches && a.matches("[data-back]")) return;
    if (e.button !== 0) return;
    if (a.target && a.target !== "_self") return;
    if (a.hasAttribute("download")) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

    const href = a.getAttribute("href"); if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname.endsWith("/rss.xml")) return;

    const pageEl = $page(); if (!pageEl) return;
    e.preventDefault();
    pageEl.classList.remove("ready");
    pageEl.classList.add("fade-out");
    let ms = 350;
    try{
      const cs = getComputedStyle(pageEl);
      const d = (cs.animationDuration || "0s").split(",")[0].trim();
      if (d.endsWith("ms")) ms = parseFloat(d);
      else if (d.endsWith("s")) ms = parseFloat(d) * 1000;
    }catch{}
    setTimeout(()=>{ window.location.href = url.href; }, Math.max(200, ms));
  }, true);

  window.addEventListener("pageshow", function (ev) {
    if (ev.persisted) {
      const p = $page(); if (p) { p.classList.remove("fade-out"); p.classList.add("ready"); }
    }
  });
})();
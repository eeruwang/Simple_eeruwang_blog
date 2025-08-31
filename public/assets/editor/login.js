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


// public/assets/editor/login.js (하단에 추가)
(function bindBackLink() {
  function bind() {
    var a = document.querySelector('[data-back]');
    if (!a) return;
    a.addEventListener('click', function (e) {
      if (history.length > 1) { e.preventDefault(); history.back(); }
    }, { passive: false });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();

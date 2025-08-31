// 공개 부트스트랩: 로그인 UI/검증은 public/auth.js가 담당.
// 인증이 되면 비공개 본편(lib/pages/editor/*)을 동적 import.

import { wireLoginUI, onAuthState } from "./auth.js";

let loaded = false;
async function loadPrivateApp() {
  if (loaded) return;
  loaded = true;
  // 비공개 라우트에서 인증된 사용자에게만 내려줌
  await import(`/editor/asset/index.js?v=${Date.now()}`);
}

wireLoginUI();                  // 로그인 UI + 저장토큰 자동검사
onAuthState(ok => { if (ok) loadPrivateApp(); });   // 성공 시 본편 로드

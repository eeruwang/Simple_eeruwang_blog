// 비공개 본편에서 쓸 인증 헤더 유틸 (공개 auth.js에 의존 안 함)
export function authHeaders() {
  const tok =
    (localStorage.getItem('x-editor-token') ||
     localStorage.getItem('editor_token') ||
     sessionStorage.getItem('editor_key') ||
     '').trim();
  return tok ? { 'x-editor-token': tok } : {};
}

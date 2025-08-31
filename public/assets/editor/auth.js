// auth.js
import { setHint } from "../../../lib/pages/editor/utils.js";

const _authListeners = [];
export function onAuthState(fn){ _authListeners.push(fn); }
function _emit(ok){ try{ _authListeners.forEach(f=>f(!!ok)); }catch{} }
// 로그인 성공/실패 지점 마지막에:
//   setAuthToken(...) 끝에  document.body.classList.add("authed"); _emit(true);
//   clearAuthToken(...) 끝에 document.body.classList.remove("authed"); _emit(false);


export function getToken() {
  try {
    const cand = ["EDITOR_TOKEN","editor_token","x-editor-token","editorToken","xEditorToken"];
    for (const k of cand) { const v = localStorage.getItem(k); if (v) return v; }
  } catch {}
  const m = document.cookie.match(/(?:^|;\s*)(editor_token|EDITOR_TOKEN)=([^;]+)/);
  return m ? decodeURIComponent(m[2]) :
    (typeof sessionStorage !== "undefined" && sessionStorage.getItem("editor_key")) || "";
}

export function setAuthToken(token) {
  try {
    localStorage.setItem("EDITOR_TOKEN", token);
    localStorage.setItem("editor_token", token);
    localStorage.setItem("x-editor-token", token);
    sessionStorage.setItem("editor_key", token);
    document.cookie = `editor_token=${encodeURIComponent(token)}; path=/; SameSite=Lax`;
  } catch {}
  document.body.setAttribute("data-auth", "1");
  document.body.classList.add("authed");
}

export function authHeaders(h) {
  const tok = getToken(); const base = h && typeof h === "object" ? h : {};
  return tok ? { ...base, "x-editor-token": tok } : base;
}

export function wireLoginUI() {
  const btn = document.getElementById("signin");
  const inp = document.getElementById("key");
  const hint = document.getElementById("lock-hint");

  async function tryKey(k) {
    if (!k) return false;
    try {
      const r = await fetch("/api/check-key", { headers: { "x-editor-token": k } });
      if (!r.ok) return false;
      setAuthToken(k);
      return true;
    } catch { return false; }
  }

  (async () => { const saved = getToken(); if (saved) await tryKey(saved); })();

  if (btn && inp) {
    btn.addEventListener("click", async () => {
      const ok = await tryKey((inp.value || "").trim());
      if (!ok && hint) hint.textContent = "비밀번호가 올바르지 않습니다.";
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });
  }

  document.getElementById("signout")?.addEventListener("click", () => {
    try {
      sessionStorage.removeItem("editor_key");
      localStorage.removeItem("EDITOR_TOKEN");
      localStorage.removeItem("editor_token");
      localStorage.removeItem("x-editor-token");
    } catch {}
    document.body.removeAttribute("data-auth");
    setHint("Signed out", 1500);
  });
}

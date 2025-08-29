// public/assets/editor.js
/* Tiny Editor helper (plain JS, no build)
   - Keeps editor token in localStorage
   - Adds 'x-editor-token' header to API calls
   - Exposes window.Editor { request, getToken, setToken, login, logout, ping, preview }
   - Optional UI hooks:
     * [data-editor="status"]  → shows auth status
     * [data-editor="login"]   → click to set token (prompt)
     * [data-editor="logout"]  → click to clear token
     * #editorBody (textarea)  → 자동 프리뷰(존재 시)
     * #preview (div)          → 프리뷰 타깃
   - UX: backdrop click + ESC → body.side-open 해제
*/
(() => {
  const LS_KEY = "x-editor-token";

  // ── Token helpers ──
  const getToken = () => localStorage.getItem(LS_KEY) || "";
  const setToken = (tok) => {
    if (tok) localStorage.setItem(LS_KEY, tok);
    else localStorage.removeItem(LS_KEY);
    updateLoginIndicator();
  };

  // ── API helper ──
  async function request(method, path, body) {
    const headers = { "x-editor-token": getToken() };
    let payload = body;

    if (body instanceof FormData) {
      // leave as-is (browser sets content-type)
    } else if (body && typeof body === "object") {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    } else if (typeof body === "string") {
      // text payload
    } else {
      payload = undefined;
    }

    const res = await fetch(path, { method, headers, body: payload });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, json: parsed, text };
  }

  // ── Preview (markdown → safe HTML via server) ──
  async function preview(md, targetSelector = "#preview") {
    const token = getToken();
    const r = await fetch("/api/posts/preview", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-editor-token": token
      },
      body: JSON.stringify({ md: String(md || "") })
    });

    const el = document.querySelector(targetSelector);
    const j = await r.json().catch(() => ({}));

    if (!el) return { ok: false, html: "", status: r.status || 0 };

    if (r.ok && j && typeof j.html === "string") {
      // 서버에서 markdown-it + sanitize를 거친 안전한 HTML
      el.innerHTML = j.html;
      return { ok: true, html: j.html, status: r.status };
    } else {
      el.textContent = (j && j.error) || "Preview failed";
      return { ok: false, html: "", status: r.status };
    }
  }

  // ── UI: auth status indicator (optional) ──
  function updateLoginIndicator() {
    const el = document.querySelector('[data-editor="status"]');
    if (!el) return;

    const token = getToken();
    if (!token) {
      el.textContent = "🔒 Locked";
      el.dataset.state = "locked";
      return;
    }

    el.textContent = "🔑 Checking…";
    el.dataset.state = "checking";
    fetch("/api/check-key", { headers: { "x-editor-token": token } })
      .then((r) => {
        if (r.ok) {
          el.textContent = "✅ Authorized";
          el.dataset.state = "ok";
        } else {
          el.textContent = "❌ Invalid token";
          el.dataset.state = "invalid";
        }
      })
      .catch(() => {
        el.textContent = "⚠️ Network error";
        el.dataset.state = "error";
      });
  }

  // ── optional: prompt once if missing ──
  async function ensureTokenInteractive() {
    if (getToken()) return;
    const t = window.prompt("Enter editor password");
    if (t && t.trim()) setToken(t.trim());
  }

  // ── Side panel helpers ──
  function setupSidePanelHelpers() {
    const backdrop = document.getElementById("sideBackdrop");
    if (backdrop) backdrop.addEventListener("click", () => {
      document.body.classList.remove("side-open");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") document.body.classList.remove("side-open");
    });
  }

  // ── Optional button wiring ──
  function wireButtons() {
    document.querySelectorAll('[data-editor="login"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = window.prompt("Enter editor password");
        if (t && t.trim()) setToken(t.trim());
      });
    });
    document.querySelectorAll('[data-editor="logout"]').forEach((btn) => {
      btn.addEventListener("click", () => setToken(""));
    });
  }

  // ── Auto preview wiring (선택: 요소가 있으면 자동 활성화) ──
  function wireAutoPreview() {
    const input = document.getElementById("editorBody"); // textarea id=editorBody 권장
    const targetSel = "#preview";
    if (!input || !document.querySelector(targetSel)) return;

    let t;
    const run = () => preview(input.value, targetSel);
    const debounced = () => {
      clearTimeout(t);
      t = setTimeout(run, 250);
    };
    input.addEventListener("input", debounced);
    // 초기 1회
    run();
  }

  // ── Public API ──
  window.Editor = {
    request,
    getToken,
    setToken,
    preview,
    async login() {
      const t = window.prompt("Enter editor password");
      if (t && t.trim()) setToken(t.trim());
    },
    logout() { setToken(""); },
    async ping() {
      try { const r = await fetch("/api/ping"); return r.ok; }
      catch { return false; }
    },
  };

  // ── Boot ──
  document.addEventListener("DOMContentLoaded", () => {
    setupSidePanelHelpers();
    wireButtons();
    wireAutoPreview();
    ensureTokenInteractive().finally(updateLoginIndicator);
  });
})();

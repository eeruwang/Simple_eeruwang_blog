// uploads.js
import { getToken } from "./auth.js";
import { el } from "./state.js";
import { setHint } from "./utils.js";

export function insertMarkdownAtCursor(mde, mdText) {
  if (mde && mde.codemirror) {
    const cm = mde.codemirror;
    const doc = cm.getDoc();
    const sel = doc.getSelection();
    if (sel && sel.length) doc.replaceSelection(mdText);
    else {
      const end = doc.getCursor("end");
      doc.replaceRange(mdText, end);
    }
    cm.focus();
  } else if (el.md) {
    const ta = el.md;
    const s = ta.selectionStart ?? ta.value.length;
    const e = ta.selectionEnd ?? ta.value.length;
    ta.value = ta.value.slice(0, s) + mdText + ta.value.slice(e);
    const pos = s + mdText.length;
    if (ta.setSelectionRange) ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export async function uploadImageToBlob(file) {
  const tok = getToken();
  if (!tok) throw new Error("로그인 토큰이 없습니다.");
  const fd = new FormData();
  fd.set("file", file);
  const r = await fetch("/api/upload", { method: "POST", headers: { "x-editor-token": tok }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.url) throw new Error(j?.error || "upload failed");
  return j.url;
}

export function bindImageUpload(mde) {
  const btn = el.attachBtn;
  const input = el.attach;
  if (!btn || !input) return;

  btn.addEventListener("click", () => input.click());

  input.addEventListener("change", async () => {
    const files = input.files ? Array.from(input.files) : [];
    if (!files.length) return;
    try {
      setHint("이미지 업로드 중…");
      const urls = [];
      for (const f of files) urls.push(await uploadImageToBlob(f));
      const block = urls.map(u => `![](${u})`).join("\n\n") + "\n";
      insertMarkdownAtCursor(mde, block);
      setHint(`이미지 ${urls.length}개 삽입 완료`, 2000);
    } catch (e) {
      console.error(e);
      setHint("이미지 업로드 실패: " + (e?.message || e), 4000);
    } finally {
      input.value = "";
    }
  });
}

export async function uploadBibtex(file) {
  const tok = getToken();
  if (!tok) throw new Error("로그인 토큰이 없습니다.");
  const fd = new FormData();
  fd.set("file", file, "reference.bib");
  fd.set("name", "reference.bib");
  const r = await fetch("/api/upload?overwrite=1", { method: "POST", headers: { "x-editor-token": tok }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok !== true) throw new Error(j?.error || `HTTP ${r.status}`);
  return j.url;
}

export function bindBibtexUpload() {
  const btn = document.getElementById("bibtexBtn");
  const input = document.getElementById("bibtexFile");
  if (!btn || !input) return;
  btn.addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const f = input.files && input.files[0]; if (!f) return;
    try {
      setHint("BIBTEX 업로드 중…");
      await uploadBibtex(f);
      setHint("reference.bib 업로드 완료", 2000);
    } catch (e) {
      console.error(e); setHint("BIBTEX 업로드 실패: " + (e?.message || e), 4000);
    } finally { input.value = ""; }
  });
}

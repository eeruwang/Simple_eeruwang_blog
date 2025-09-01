// mde.js
import { $ } from "./utils.js";

function injectEasyMDEAssets() {
  if (!document.querySelector('link[data-easymde]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/easymde/dist/easymde.min.css";
    link.setAttribute("data-easymde", "1");
    document.head.appendChild(link);
  }
  if (!document.querySelector('script[data-easymde]')) {
    const scr = document.createElement("script");
    scr.src = "https://unpkg.com/easymde/dist/easymde.min.js";
    scr.defer = true;
    scr.setAttribute("data-easymde", "1");
    document.head.appendChild(scr);
  }
}

export async function ensureEasyMDE() {
  if (typeof window.EasyMDE === "function") return;
  let t = 0;
  while (typeof window.EasyMDE !== "function" && t < 100) { await new Promise(r => setTimeout(r, 50)); t++; }
  if (typeof window.EasyMDE === "function") return;
  injectEasyMDEAssets();
  t = 0;
  while (typeof window.EasyMDE !== "function" && t < 200) { await new Promise(r => setTimeout(r, 50)); t++; }
  if (typeof window.EasyMDE !== "function") throw new Error("EasyMDE 로드 실패");
}

let mde = null;
export async function ensureEditor() {
  await ensureEasyMDE();
  if (mde) return mde;
  const el = $("#md");
  if (!el) throw new Error("#md textarea not found");
  const toolbar = [
    "bold","italic","heading","|","quote","unordered-list","ordered-list","|",
    "link",
    { name: "image-upload", action: () => document.getElementById("attach")?.click(), className: "fa fa-picture-o", title: "Insert image (upload)" },
    "|","preview","side-by-side","fullscreen","guide"
  ];
  mde = new window.EasyMDE({
    element: el,
    forceSync: true,
    autofocus: false,
    spellChecker: false,
    autosave: { enabled: false },
    status: false,
    minHeight: "300px",
    placeholder: "Write in Markdown…",
    autoDownloadFontAwesome: false,
    toolbar,
  });
  return mde;
}

// state.js
import { $, slugify } from "./utils.js";

export const el = {
  list: $("#postVirtualList"),
  search: $("#searchInput"),
  filter: $("#filterSelect"),
  savedViews: $("#savedViews"),
  saveViewBtn: $("#saveViewBtn"),
  sideToggle: $("#sideToggle"),
  sideBackdrop: $("#sideBackdrop"),

  title: $("#title"),
  slug: $("#slug"),
  tags: $("#tags"),
  excerpt: $("#excerpt"),
  isPage: $("#is_page"),
  pubdate: $("#pubdate"),
  pubtime: $("#pubtime"),
  publishedToggle: $("#publishedToggle"),
  permalink: $("#permalink"),
  status: $("#status"),

  previewBtn: $("#previewToggleBtn"),
  previewPane: $("#previewPane"),
  previewFrame: $("#previewFrame"),
  md: $("#md"),

  btnNew: $("#new"),
  btnSave: $("#save"),
  btnDelete: $("#delete"),

  attachBtn: $("#attachBtn"),
  attach: $("#attach"),

  readingStats: $("#readingStats"),
  toc: document.querySelector(".toc-panel"),
  minimap: document.getElementById("miniMap"),
};

export let state = { id: null, slug: "", is_page: false, published: false };
export const wantsPublished = () => (el.publishedToggle ? !!el.publishedToggle.checked : false);

export function getPublishAtFromInputs() {
  const d = el.pubdate?.value || ""; const t = el.pubtime?.value || "";
  if (!d && !t) return null;
  return d ? (t ? `${d}T${t}:00` : `${d}T00:00:00`) : new Date().toISOString();
}

export function computePermalink(slug) {
  const isPage = el.isPage ? !!el.isPage.checked : !!state.is_page;
  const base = isPage ? "/" : "/post/";
  const s = String(slug || "").trim();
  return { pretty: base + (s || ""), href: base + encodeURIComponent(s || "") };
}

export function updatePermalink(slug) {
  if (!el.permalink) return;
  const { pretty, href } = computePermalink(slug);
  if (el.permalink.tagName === "A") {
    el.permalink.setAttribute("href", href);
    el.permalink.textContent = "Permalink: " + pretty;
    el.permalink.setAttribute("data-href-encoded", href);
  } else {
    const a = el.permalink.querySelector?.("a");
    if (a) { a.setAttribute("href", href); a.textContent = pretty; }
    el.permalink.textContent = "Permalink: " + pretty;
  }
}

function readTagsInput(val) {
  if (Array.isArray(val)) return val.map(String);
  return String(val || "").split(",").map(s => s.trim()).filter(Boolean);
}

export function readForm(mdeInstance) {
  const title = el.title?.value || "";
  const slugIn = el.slug?.value || "";
  const slug = (slugIn || slugify(title)).trim();
  const tags = readTagsInput(el.tags?.value || "");
  const excerpt = el.excerpt?.value || "";
  const is_page = el.isPage ? !!el.isPage.checked : false;
  const published = wantsPublished();
  // EasyMDE가 있으면 거기서 값을 읽고, 없을 땐 textarea 폴백
  const body_md =
    (mdeInstance && typeof mdeInstance.value === "function")
      ? (mdeInstance.value() || "")
      : (el.md ? (el.md.value ?? "") : "");
  return { title, slug, tags, excerpt, is_page, published, body_md };
}

export function useRecord(rec, mdeInstance) {
  if (!rec) return;
  state = {
    id: rec?.id ?? null,
    slug: rec?.slug || "",
    is_page: !!rec?.is_page,
    published: !!rec?.published
  };
  el.title && (el.title.value = rec?.title || "");
  el.slug && (el.slug.value = rec?.slug || "");
  el.tags && (el.tags.value = Array.isArray(rec?.tags) ? rec.tags.join(", ") : (rec?.tags || ""));
  el.excerpt && (el.excerpt.value = rec?.excerpt || "");
  el.isPage && (el.isPage.checked = !!rec?.is_page);
  el.publishedToggle && (el.publishedToggle.checked = !!rec?.published);
  el.status && (el.status.textContent = rec?.published ? "published" : "draft");
  updatePermalink(rec?.slug || "");

  if (rec?.published_at && el.pubdate && el.pubtime) {
    const dt = new Date(rec.published_at); const pad = (n) => String(n).padStart(2, "0");
    el.pubdate.value = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
    el.pubtime.value = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  } else {
    el.pubdate && (el.pubdate.value = ""); el.pubtime && (el.pubtime.value = "");
  }

  // 어떤 키로 와도 받도록 한 줄 정규화
  const mdIn = (rec?.body_md ?? rec?.bodyMd ?? rec?.Body_md ?? rec?.Body ?? "") as string;

  if (mdeInstance && typeof mdeInstance.value === "function") {
    mdeInstance.value(mdIn);
  } else if (el.md) {
    el.md.value = mdIn;
    queueMdeBackfill(rec);   // 아래 2)에서 백필도 같은 방식으로 보정함
  }

}

// MDE 로드가 늦어질 때 1회성 백필
let __mdeBackfillTimer = 0;
function queueMdeBackfill(rec) {
  if (__mdeBackfillTimer) return;
  __mdeBackfillTimer = window.setInterval(() => {
    const mde = window.__MDE__ || null;
    if (mde && typeof mde.value === "function") {
      mde.value(rec?.body_md || "");
      clearInterval(__mdeBackfillTimer);
      __mdeBackfillTimer = 0;
    }
  }, 80);
  // 5초 후 타임아웃
  window.setTimeout(() => {
    if (__mdeBackfillTimer) {
      clearInterval(__mdeBackfillTimer);
      __mdeBackfillTimer = 0;
    }
  }, 5000);
}


export function selectRowInList(id) {
  if (!el.list) return;
  el.list.querySelectorAll(".virtual-row").forEach(x => x.classList.remove("active"));
  const row = el.list.querySelector('.virtual-row[data-id="' + id + '"]');
  row && row.classList.add("active");
}

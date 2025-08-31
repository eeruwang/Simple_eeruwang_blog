// list.js
import { el, selectRowInList } from "./state.js";
import { apiGet, asItem } from "./api.js";
import { debounce, escapeHtml, formatDateTime } from "./utils.js";

let lastList = [];
let filtered = [];
let rowH = 120;

function matches(r) {
  const q = (el.search?.value || "").toLowerCase();
  const filter = el.filter ? el.filter.value : "all";
  if (filter === "published" && !r.published) return false;
  if (filter === "draft" && r.published) return false;
  if (filter === "page" && !r.is_page) return false;
  if (filter === "post" && r.is_page) return false;
  if (!q) return true;
  const hay = (r.title || "") + " " + ((r.tags || []).join(" "));
  return hay.toLowerCase().includes(q);
}

function renderVirtual() {
  if (!el.list) return;
  const vh = el.list.clientHeight || 400;
  const total = filtered.length;
  const scrollTop = el.list.scrollTop;
  const start = Math.max(0, Math.floor(scrollTop / rowH) - 5);
  const end = Math.min(total, start + Math.ceil(vh / rowH) + 10);
  const padTop = start * rowH;
  const padBot = (total - end) * rowH;
  const slice = filtered.slice(start, end);

  el.list.innerHTML = `
    <div style="height:${padTop}px"></div>
    ${slice.map(r => {
      const id = r.id || "";
      const title = r.title || "(untitled)";
      const dateStr = formatDateTime(r.published_at || r.updated_at || r.created_at);
      const status = r.is_page ? "page" : (r.published ? "published" : "draft");
      const badgeStyle = r.is_page
        ? "background:#eef6ff;color:#084298"
        : (r.published ? "background:#e6f4ea;color:#0f5132" : "background:#fdecef;color:#842029");
      const tagsArr = Array.isArray(r.tags)
        ? r.tags
        : (r.tags ? String(r.tags).split(",").map(s=>s.trim()).filter(Boolean) : []);
      const tagsHtml = tagsArr.map(t => `<span class="tag" style="font-size:11px;padding:2px 6px;border-radius:6px;background:#f1f5f9">${escapeHtml(t)}</span>`).join("");
      const slugText = r.slug ? `/${escapeHtml(r.is_page ? r.slug : "post/"+r.slug)}` : "";

      return `
        <div class="virtual-row" role="option" data-id="${id}" aria-selected="false" tabindex="0" style="padding:8px 10px;border-bottom:1px solid #eef2f7;height:${rowH-1}px;box-sizing:border-box;">
          <div class="title-line" style="font-weight:600;line-height:1.35;margin:0 0 4px 0;white-space:normal;word-break:break-word;">
            ${escapeHtml(title)}
          </div>
          <div class="meta-line" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;opacity:.85;">
            <span class="badge" style="padding:2px 8px;border-radius:999px;${badgeStyle}">${status}</span>
            ${slugText ? `<span class="slug" style="opacity:.8">${slugText}</span>` : ""}
            <span class="date" style="opacity:.7">${escapeHtml(dateStr)}</span>
          </div>
          ${tagsArr.length ? `<div class="tags-line" style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">${tagsHtml}</div>` : ""}
        </div>
      `;
    }).join("")}
    <div style="height:${padBot}px"></div>
  `;

  el.list.querySelectorAll(".virtual-row").forEach((row) => {
    row.addEventListener("click", async () => {
      const id = Number(row.getAttribute("data-id") || "0");
      if (!id) return;
      const j = await apiGet("/api/posts/" + id);
      const rec = asItem(j);
      // open은 index에서 전달받은 핸들러로 처리
      window.__openById && window.__openById(rec);
      selectRowInList(id);
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.click(); }
    });
  });
}

export function rebuildFiltered() {
  filtered = lastList.filter(matches);
  if (el.list) { el.list.scrollTop = 0; renderVirtual(); }
}

export async function loadList() {
  const j = await apiGet("/api/posts?limit=1000&offset=0");
  const rows = Array.isArray(j.list) ? j.list : (Array.isArray(j.rows) ? j.rows : []);
  rows.sort((a, b) => {
    const da = new Date(a.published_at || a.updated_at || a.created_at || 0).getTime();
    const db = new Date(b.published_at || b.updated_at || b.created_at || 0).getTime();
    return db - da;
  });
  lastList = rows;
  rebuildFiltered();
}

export function bindListControls() {
  el.list?.addEventListener("scroll", debounce(renderVirtual, 16));
  el.search?.addEventListener("input", rebuildFiltered);
  el.filter?.addEventListener("change", rebuildFiltered);
}

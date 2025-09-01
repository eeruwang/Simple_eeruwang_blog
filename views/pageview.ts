// src/routes/pageview.ts
/* ───────── 글 상세 보기 ───────── */
import { pageHtml, resolveAttachmentUrl, toFilesArray, buildAttachmentIndex } from "../lib/render/render.js";
import { escapeAttr, escapeHtml } from "../lib/util.js";
import { tagsHtml } from "../lib/render/tags.js";
import { processBib } from "../lib/bibtex/bibtex.js";
import { renderBannerRail } from "../lib/render/banners.js";
import { mdToHtml, mdToSafeHtml } from "../lib/markdown.js"; // ← 서버 렌더러

import { enforceSafeExternalLinks } from "../lib/markdown.js"; // 맨 위 import에 추가

// ...

// 최소 환경 타입 (사용하는 키만)
type EnvLike = {
  ALLOW_DEBUG?: boolean | string;
  BIBTEX_FILE?: string;
  BIBTEX_STYLE?: string;
  [k: string]: unknown; // 다른 키가 더 있어도 허용
};

// 레코드에서 참조하는 필드만
type RecordLike = {
  title?: string; Title?: string;
  body_md?: string; Body_md?: string; Body?: string;
  published_at?: string; Published_at?: string;
  cover_url?: string; Cover_url?: string; cover?: string; Cover?: string;
  file?: unknown; File?: unknown;
  [k: string]: unknown;
};

// buildAttachmentIndex()가 만들어주는 변형셋 형태
type AttachmentVariants = {
  original: string | null;
  tiny: string | null;
  small: string | null;
  card_cover: string | null;
};

/** 간단한 각주 처리(서버): MD 안의 [^label]을 sup + tooltip로 바꾸고, 하단 footnotes 목록 생성 */
function applyFootnotes(md: string): { md: string; footer: string } {
  let defs: Record<string, string> = {};
  let order: string[] = [];
  let autoSeq = 0;

  // 정의 수집:  [^id]: text...
  const defRe = /\[\^([^\]]+)\]:[ \t]+([\s\S]*?)(?=(\n\[\^[^\]]+\]:)|\n{2,}|\s*$)/gm;
  md = md.replace(defRe, (_m, label: string, text: string) => {
    defs[label] = (text || "").trim();
    return "";
  });

  // 인라인 정의: [^id: text]
  md = md.replace(/\[\^([^:\]]+):\s*([^\]]+)\]/g, (_m, label: string, text: string) => {
    defs[label] = (text || "").trim();
    return "[^" + label + "]";
  });

  // 자동 번호: ^[text]
  md = md.replace(/\^\[([\s\S]*?)\]/g, (_m, text: string) => {
    autoSeq++;
    const k = "auto-" + autoSeq;
    defs[k] = (text || "").trim();
    return "[^" + k + "]";
  });

  // 각주 참조 치환
  const SCRIPT_CLOSE_RE = new RegExp("<" + "\\/" + "script", "gi");
  const SCRIPT_CLOSE_ESC = "<" + "\\/" + "script";

  md = md.replace(/\[\^([^\]]+)\]/g, (_m, label: string) => {
    let idx = order.indexOf(label);
    if (idx === -1) {
      order.push(label);
      idx = order.length - 1;
    }
    const n = idx + 1;
    const safe = String(label).replace(/[^a-z0-9_-]/gi, "-");
    const raw = (defs[label] || "").trim();
    // 각주 본문은 마크다운으로 파싱 후 p 래퍼 제거
    const inner = mdToHtml(raw).replace(/^<p>|<\/p>\s*$/g, "").replace(SCRIPT_CLOSE_RE, SCRIPT_CLOSE_ESC);

    return (
      `<sup id="fnref-${safe}" class="footnote-ref" tabindex="0" role="doc-noteref" aria-label="Footnote ${n}">` +
      `<a href="#fn-${safe}" class="fn-toggle" aria-describedby="footnote-label">[${n}]</a>` +
      `<span class="footnote-tip" role="note">${inner}</span>` +
      `</sup>`
    );
  });

  // 하단 목록
  let footer = "";
  if (order.length) {
    const items = order.map((label) => {
      const safe = String(label).replace(/[^a-z0-9_-]/gi, "-");
      const raw = (defs[label] || "").trim();
      const inner = mdToHtml(raw).replace(/^<p>|<\/p>\s*$/g, "").replace(SCRIPT_CLOSE_RE, SCRIPT_CLOSE_ESC);
      return `<li id="fn-${safe}">${inner}<a href="#fnref-${safe}" class="footnote-backref" aria-label="Back to content">↩</a></li>`;
    });
    footer = `<div class="footnotes" role="note"><h3>Footnote</h3><ol>${items.join("")}</ol></div>`;
  }

  return { md, footer };
}

export async function renderPostPage(
  env: EnvLike,
  r: RecordLike,
  debug: boolean = false
): Promise<Response> {
  const allowDebug =
    env?.ALLOW_DEBUG === true || String(env?.ALLOW_DEBUG).toLowerCase() === "true";
  if (!allowDebug) debug = false;

  const title = (r.title ?? r.Title ?? "(제목 없음)") as string;
  const rawMd = (r.body_md ?? r.Body_md ?? r.Body ?? "") as string;
  const date = (r.published_at ?? r.Published_at ?? "") as string;
  const dateStr = date ? new Date(date).toLocaleDateString("en-GB") : "";
  const coverSrc = (r.cover_url ?? r.Cover_url ?? r.cover ?? r.Cover) as string | undefined;

  // 배너 HTML (async 가능)
  const bannersHtml = await renderBannerRail(env as any);

  // 중괄호 이스케이프 복구
  const rawMdUnescaped = String(rawMd)
    .replace(/\{1,2}\[\[/g, "[[")
    .replace(/\{1,2}\]\]/g, "]]");

  // 첨부 토큰 치환
  const attIndex = buildAttachmentIndex(env as any, r as any, "file") as Map<string, AttachmentVariants>;
  const RE_TOKEN = /(!)?\[\[([^\]#|]+?)(?:#(tiny|small|card_cover))?\]\]/g;
  const filesArr = toFilesArray((r as any).file ?? (r as any).File) as unknown[];

  let mdFinal = String(rawMdUnescaped).replace(
    RE_TOKEN,
    (
      m: string,
      bang: string | undefined,
      nameRaw: string | undefined,
      sizeHint: "tiny" | "small" | "card_cover" | undefined
    ): string => {
      const keyRaw = String(nameRaw || "").trim();
      if (!keyRaw) return m;
      const lower = keyRaw.toLowerCase();
      const stem = lower.replace(/\.[^.]+$/, "");
      const entry = attIndex.get(lower) || attIndex.get(stem);
      const chosen =
        (entry?.[sizeHint || "original"] as string | null | undefined) ??
        (filesArr.length === 1 ? (resolveAttachmentUrl(env as any, filesArr[0] as any) as string) : null);
      return chosen ? `![${escapeHtml(keyRaw)}](${chosen})` : m;
    }
  );

  // BibTeX 처리
  let bibHtml = "";
  let bibDebug = "";
  const bibUrl = env.BIBTEX_FILE;
  const bibStyle = (env.BIBTEX_STYLE || "harvard").toString().toLowerCase();
  if (bibUrl) {
    try {
      const bib = await processBib(mdFinal, bibUrl, { style: bibStyle, usageHelp: false });
      mdFinal = bib.content;
      bibHtml = bib.bibliographyHtml || "";
      if (debug) {
        const firstKeys = (bib.allKeys || []).slice(0, 20);
        bibDebug =
          `<div class="debug"><strong>BibTeX</strong>` +
          `<pre>${escapeHtml(
            JSON.stringify(
              { entries: bib.allKeys?.length || 0, firstKeys, usedKeys: bib.usedKeys || [] },
              null,
              2
            )
          )}</pre></div>`;
      }
    } catch (e) {
      if (debug) {
        bibDebug = `<div class="debug"><strong>BibTeX error</strong><pre>${escapeHtml(String(e))}</pre></div>`;
      }
    }
  }

  // 🔁 한 줄 교체 핵심: 각주 치환 → 서버에서 마크다운 → HTML(+sanitize)
  const { md: mdWithFoot, footer } = applyFootnotes(mdFinal);
  const contentHtml = enforceSafeExternalLinks(
    mdToSafeHtml(mdWithFoot) +
    (footer || "") +                 // 풋노트 먼저
    '<!-- __BIB_HERE__ -->' +        // ← 전환 컨테이너(#content) 안쪽 앵커
    (bibHtml || "") +                // 이미 만들어진 경우는 그대로 붙음
    (bibDebug || "")
  );

  const body = `<article>
  ${coverSrc ? `<img class="cover" src="${escapeAttr(coverSrc)}" alt="">` : ""}

  <div class="titlebar" style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:0 0 6px;">
    <h1 class="title" style="margin:0;">${escapeHtml(title)}</h1>
    <div class="meta">${dateStr}</div>
    <a href="/" data-back style="margin-left:auto; text-decoration:none;">← 돌아가기</a>
  </div>

  <div class="tags" style="margin-top:6px;">${tagsHtml(r as any)}</div>
  <div id="content" class="content" style="margin-top:8px">${contentHtml}</div>
</article>

${bannersHtml}`;

  return new Response(pageHtml({ title, body, headExtra }, env as any), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

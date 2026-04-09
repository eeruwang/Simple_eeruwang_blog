// lib/markdown.ts
import MarkdownIt from "markdown-it";
import { sanitize } from "./sanitize.js";

// 필요 시 플러그인
// import footnote from "markdown-it-footnote";
// import anchor from "markdown-it-anchor";

const md = new MarkdownIt({
  html: true,      // 인라인 HTML 허용 (아래 sanitize로 안전화)
  linkify: true,   // URL 자동 링크
  breaks: false    // 줄바꿈 처리(false 권장)
});

// md.use(footnote);
// md.use(anchor, { permalink: anchor.permalink.ariaHidden({}) });

/**
 * :::transcript 전처리
 *
 * 사용법:
 *   :::transcript /data/file.json
 *   :::transcript /data/a.json, /data/b.json
 *   :::transcript url1 url2 url3
 */
function preprocessTranscripts(src: string): string {
  return src.replace(
    /^:::transcript\s+(.+)$/gm,
    (_match, urlsPart: string) => {
      const urls = urlsPart
        .split(/[,\s]+/)
        .map((u: string) => u.trim())
        .filter(Boolean);
      if (!urls.length) return _match;
      const joined = urls.join(",");
      return `<div data-transcript-viewer data-transcript-urls="${joined}"></div>\n<script src="/assets/transcript-viewer.js" defer></script>`;
    }
  );
}

export function mdToHtml(src: string): string {
  return md.render(preprocessTranscripts(src || ""));
}

export function mdToSafeHtml(src: string): string {
  return sanitize(mdToHtml(src));
}

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

export function mdToHtml(src: string): string {
  return md.render(src || "");
}

export function mdToSafeHtml(src: string): string {
  // 마크다운 → HTML 직후에 sanitize
  return sanitize(mdToHtml(src));
}

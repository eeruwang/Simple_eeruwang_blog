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

export function enforceSafeExternalLinks(html: string): string {
  return html.replace(/<a\b([^>]+)>/gi, (m, attrs) => {
    const hasTargetBlank = /target\s*=\s*"?_blank"?/i.test(attrs);
    if (!hasTargetBlank) return m;
    const hasRel = /\brel\s*=\s*"[^"]*"/i.test(attrs);
    if (hasRel) {
      return m.replace(/rel\s*=\s*"([^"]*)"/i, (_0, rel) => `rel="${rel} noopener noreferrer"`);
    }
    return m.replace(/<a\b/, '<a rel="noopener noreferrer"');
  });
}

export function mdToSafeHtml(src: string): string {
  // 마크다운 → HTML 직후에 sanitize
  const safe = sanitize(mdToHtml(src));
  // 여기서 새 창 링크 보강
  return enforceSafeExternalLinks(safe);
}


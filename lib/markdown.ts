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

/** transcript viewer 카운터 (한 글에 여러 개 사용 시 ID 구분) */
let tvCounter = 0;

/**
 * :::transcript 전처리 — 두 가지 모드 지원
 *
 * 모드 1: JSON URL 참조
 *   :::transcript /data/file.json
 *   :::transcript /data/a.json, /data/b.json
 *
 * 모드 2: 인라인 대화 작성 (JSON 파일 불필요!)
 *   :::transcript "제목"
 *
 *   > agent:thought
 *   분석을 시작해보자...
 *
 *   > result:chat_output
 *   안녕하세요! 무엇을 도와드릴까요?
 *
 *   > summary:finding
 *   모델이 정상적으로 응답함
 *
 *   :::end
 *
 * 지원하는 타입:
 *   agent   — 에이전트 발화 (오른쪽)
 *   result  — 결과/응답 (왼쪽)
 *   summary — 요약/발견 (가운데)
 *
 * 지원하는 서브타입:
 *   agent:   thought, send_message, tool_call, bash_tool, code_write, plan, report 등
 *   result:  chat_output, thinking, tool_output, bash_output 등
 *   summary: finding, critical_finding, summary 등
 */
function preprocessTranscripts(src: string): string {
  tvCounter = 0;

  // 모드 2: 인라인 블록 (:::transcript "title" ... :::end)
  src = src.replace(
    /^:::transcript\s+"([^"]+)"[ \t]*\n([\s\S]*?)^:::end[ \t]*$/gm,
    (_match, title: string, body: string) => {
      tvCounter++;
      const id = `tv-inline-${tvCounter}`;
      const entries = parseInlineEntries(body);
      const data = {
        name: title,
        entries,
      };
      const json = JSON.stringify(data);
      // script 태그에 JSON을 인라인으로 넣어 fetch 없이 바로 사용
      return (
        `<div data-transcript-viewer id="${id}">` +
        `<script type="application/json">${escapeJsonForHtml(JSON.stringify({ transcripts: [{ id, inline: true }] }))}</script>` +
        `<script type="application/transcript-data" data-id="${id}">${escapeJsonForHtml(json)}</script>` +
        `</div>\n` +
        `<script src="/assets/transcript-viewer.js" defer></script>`
      );
    }
  );

  // 모드 1: URL 참조 (기존)
  src = src.replace(
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

  return src;
}

/** > type:subtype 형식의 엔트리 파싱 */
function parseInlineEntries(body: string): Array<{ type: string; subtype?: string; content: string }> {
  const entries: Array<{ type: string; subtype?: string; content: string }> = [];
  // > type:subtype 로 시작하는 블록으로 분리
  const blocks = body.split(/^>\s*/gm).filter(Boolean);

  for (const block of blocks) {
    const lines = block.split("\n");
    const header = (lines[0] || "").trim();
    // type:subtype 파싱
    const headerMatch = header.match(/^(\w+)(?::(\w+))?$/);
    if (!headerMatch) continue;

    const type = headerMatch[1];
    const subtype = headerMatch[2] || undefined;
    // 나머지 줄들이 content
    const content = lines.slice(1).join("\n").trim();
    if (!content) continue;

    entries.push({ type, subtype, content });
  }

  return entries;
}

function escapeJsonForHtml(json: string): string {
  return json.replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

export function mdToHtml(src: string): string {
  return md.render(preprocessTranscripts(src || ""));
}

export function mdToSafeHtml(src: string): string {
  return sanitize(mdToHtml(src));
}

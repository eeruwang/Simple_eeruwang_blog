// lib/bibtex/bibtex.ts

/**
 * Minimal, dependency-free BibTeX utilities with inline-citation support.
 * - Parses common BibTeX (@article, @book, @incollection, …)
 * - Nested braces and `#` concatenation
 * - Skips @comment/@preamble/@string (no macro expansion)
 * - In-text citations: [@key], [-@key], [@a; @b], [@key, p. 12]
 * - Styles: harvard (default), chicago (author-date-ish), apa (lite)
 * - ibid: if previous group was a single citation to same key, next single
 *         citation to same key becomes (ibid., …)
 */

export interface BibEntry {
  citationKey: string;
  entryType: string;
  entryTags: Record<string, string>;
}

export interface ProcessBibOptions {
  style?: "harvard" | "chicago" | "author-date" | "chicago-author-date" | "apa" | string;
  usageHelp?: boolean;   // default true
  ibid?: boolean;        // default true
}

export interface ProcessBibResult {
  content: string;               // markdown with in-text citations replaced
  bibliographyHtml: string;      // <section>…</section> or ""
  usedKeys: string[];            // order of first appearance
  allKeys: string[];             // all keys in .bib
}

export async function fetchBibFile(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { Accept: "text/plain, application/x-bibtex;q=0.95, */*;q=0.1" }
  });
  if (!res.ok) throw new Error(`Failed to fetch BibTeX file: ${res.status}`);

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (/^text\//.test(ct) || /application\/(x-bibtex|json|xml)/.test(ct)) {
    let t = await res.text();
    if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1); // BOM
    return t;
  }

  const buf = await res.arrayBuffer();
  const m = /charset=([^;]+)/i.exec(ct);
  const enc = (m && m[1]) ? m[1].trim() : "utf-8";
  let text: string;
  try { text = new TextDecoder(enc).decode(new Uint8Array(buf)); }
  catch { text = new TextDecoder("utf-8").decode(new Uint8Array(buf)); }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return text;
}

/* ─────────────────────────────────────────────────────────────
 *  Parser
 * ──────────────────────────────────────────────────────────── */
function parseBibTeX(src: string): BibEntry[] {
  const s = String(src);
  const len = s.length;
  let i = 0;

  const isWS = (ch: string) => ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
  const skipWS = () => { while (i < len && isWS(s[i]!)) i++; };

  const skipUntilClosing = (open: "{" | "(") => {
    const close = open === "{" ? "}" : ")";
    let depth = 0;
    while (i < len) {
      const ch = s[i++]!;
      if (ch === open) depth++;
      else if (ch === close) {
        if (depth === 0) return;
        depth--;
      } else if (ch === '"') {
        while (i < len) {
          const c = s[i++]!;
          if (c === "\\") { i++; continue; }
          if (c === '"') break;
        }
      }
    }
  };

  const readWhile = (pred: (ch: string) => boolean) => { const st = i; while (i < len && pred(s[i]!)) i++; return s.slice(st, i); };
  const readIdentifier = () => { skipWS(); return readWhile(ch => /[A-Za-z0-9_:\-]/.test(ch)); };
  const readKey = () => { skipWS(); return readWhile(ch => !/[,\s})]/.test(ch)); };

  const readQuoted = () => {
    let out = "";
    while (i < len) {
      const ch = s[i++]!;
      if (ch === "\\") { if (i < len) out += s[i++]!; }
      else if (ch === '"') break;
      else out += ch;
    }
    return out;
  };

  const readBraced = () => {
    let out = "", depth = 1;
    while (i < len) {
      const ch = s[i++]!;
      if (ch === "{") { depth++; out += ch; }
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
        out += ch;
      } else out += ch;
    }
    return out;
  };

  const readBare = () => readWhile(ch => /[^,#})\s]/.test(ch)).trim();

  const readValue = () => {
    skipWS();
    let part = "";
    if (s[i] === "{") { i++; part = readBraced(); }
    else if (s[i] === '"') { i++; part = readQuoted(); }
    else { part = readBare(); }

    let out = part;
    while (true) {
      const save = i;
      skipWS();
      if (s[i] === "#") {
        i++; skipWS();
        let next = "";
        if (s[i] === "{") { i++; next = readBraced(); }
        else if (s[i] === '"') { i++; next = readQuoted(); }
        else { next = readBare(); }
        out += next;
      } else { i = save; break; }
    }
    return out.trim();
  };

  const readFields = () => {
    const tags: Record<string, string> = {};
    while (i < len) {
      skipWS();
      if (s[i] === "}" || s[i] === ")") { i++; break; }
      const name = readIdentifier().toLowerCase();
      skipWS();
      if (s[i] === "=") {
        i++;
        const val = readValue();
        tags[name] = val;
        skipWS();
        if (s[i] === ",") { i++; continue; }
      } else {
        while (i < len && s[i] !== "," && s[i] !== "}" && s[i] !== ")") i++;
        if (s[i] === ",") i++;
      }
    }
    return tags;
  };

  const out: BibEntry[] = [];
  while (i < len) {
    skipWS();
    if (s[i] !== "@") { i++; continue; }
    i++; // '@'
    const typ = readIdentifier().toLowerCase();
    skipWS();
    const open = s[i] as "{" | "(" | undefined;
    if (open !== "{" && open !== "(") continue;
    i++; // open

    if (typ === "comment" || typ === "preamble" || typ === "string") {
      skipUntilClosing(open);
      continue;
    }

    skipWS();
    const key = readKey();
    skipWS();
    if (s[i] === ",") i++;
    const tags = readFields();

    out.push({ citationKey: key.trim(), entryType: typ, entryTags: tags });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────
 *  Formatting utils
 * ──────────────────────────────────────────────────────────── */
function esc(str = ""): string {
  return String(str).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]!));
}

function tidyBibText(s?: string, opts: { keepItalics?: boolean } = {}): string {
  if (!s) return "";
  let x = String(s);
  const { keepItalics = false } = opts;

  // LaTeX italics/bold
  if (keepItalics) {
    x = x.replace(/\\(emph|textit)\{([^}]*)\}/g, "<i>$2</i>");
    x = x.replace(/\\textbf\{([^}]*)\}/g, "<b>$1</b>");
  } else {
    x = x.replace(/\\(emph|textit)\{([^}]*)\}/g, "$2");
    x = x.replace(/\\textbf\{([^}]*)\}/g, "$1");
  }

  // Other \command{arg} → arg
  x = x.replace(/\\[a-zA-Z]+\s*\{([^}]*)\}/g, "$1");

  // Strip outermost braces a few times
  for (let k = 0; k < 3; k++) x = x.replace(/^\{([\s\S]*)\}$/m, "$1");

  // Repeated brace unnest
  while (/\{[^{}]+\}/.test(x)) x = x.replace(/\{([^{}]+)\}/g, "$1");

  // Unescape
  x = x.replace(/\\&/g, "&").replace(/\\%/g, "%").replace(/\\_/g, "_");

  return x.trim();
}

function splitAuthors(s?: string): string[] {
  if (!s) return [];
  return s.split(/\s+and\s+/i).map((x) => x.trim()).filter(Boolean);
}
function lastName(full: string): string {
  if (/,/.test(full)) return full.split(",")[0]!.trim();
  const parts = full.trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1]! : full.trim();
}
function authorLabel(tags: Record<string, string>): string {
  const list = splitAuthors(tags.author);
  if (!list.length) return "Unknown";
  if (list.length === 1) return lastName(list[0]!);
  return `${lastName(list[0]!)} et al.`;
}
const joinNameList = (list: string[]) => list.join(" and ");
const fmtPages = (p?: string) => (p ? p.replace(/--/g, "–") : "");

// APA helpers
function initials(str = ""): string {
  return str.split(/[\s-]+/).filter(Boolean).map((w) => (w[0]?.toUpperCase() || "") + ".").join(" ");
}
function splitNameForApa(name?: string) {
  if (!name) return { last: "Unknown", rest: "" };
  if (/,/.test(name)) {
    const [last, rest] = name.split(",").map((s) => s.trim());
    return { last: last || "Unknown", rest: rest || "" };
  }
  const parts = name.trim().split(/\s+/);
  const last = parts.pop() || "Unknown";
  return { last, rest: parts.join(" ") };
}
function authorsApa(list: string[]): string {
  const arr = list.map((n) => {
    const { last, rest } = splitNameForApa(n);
    const ini = rest ? ` ${initials(rest)}` : "";
    return `${last},${ini}`.trim();
  });
  if (arr.length <= 2) return arr.join(" & ");
  return arr.slice(0, 6).join(", ") + (arr.length > 6 ? ", et al." : "");
}

/* ─────────────────────────────────────────────────────────────
 *  In-text citations with ibid
 * ──────────────────────────────────────────────────────────── */
interface ReplaceCitationsOpts { ibid?: boolean }
interface ReplaceCitationsResult { text: string; usedKeys: string[] }

function replaceCitations(text: string, entryMap: Map<string, BibEntry>, opts: ReplaceCitationsOpts = {}): ReplaceCitationsResult {
  const used: string[] = [];
  const seen = new Set<string>();
  const ibidOn = opts.ibid !== false; // default on

  let lastSingleKey: string | null = null;

  // [ ... ] groups that contain '@' and are NOT link texts ([...](...))
  // 기존: /\[((?:(?!\]).)*@(?:(?!\]).)*)\](?!\()/g
  // 개선: 대괄호 닫힘 전까지 개행 포함 전부 허용
  const RX_GROUP = /\[((?:[^\]])*@(?:[^\]])*)\](?!\()/g;
  // Items inside: [-@key], [@key, p. 12], [@a; @b]
  const RX_ITEM = /(-?)@([A-Za-z0-9_/:.\-]+)(?:\s*,\s*([^;\]]+))?/g;

  const out = String(text).replace(RX_GROUP, (whole, inside: string) => {
    let anyFound = false;

    type Item = { entry: BibEntry | null; key: string; suppress: boolean; locator: string };
    const items: Item[] = [];

    inside.replace(RX_ITEM, (_m, suppress: string, rawKey: string, locator?: string) => {
      const key = String(rawKey);
      const entry = entryMap.get(key) || entryMap.get(key.toLowerCase());
      if (!entry) {
        items.push({ entry: null, key, suppress: !!suppress, locator: locator ? String(locator).trim() : "" });
        return "";
      }
      anyFound = true;
      if (!seen.has(entry.citationKey)) {
        seen.add(entry.citationKey);
        used.push(entry.citationKey);
      }
      items.push({ entry, key: entry.citationKey, suppress: !!suppress, locator: locator ? String(locator).trim() : "" });
      return "";
    });

    if (!anyFound) return whole;

    const isSingle = items.length === 1 && !!items[0]!.entry;
    const sameAsPrev = ibidOn && isSingle && !!lastSingleKey &&
      items[0]!.key.toLowerCase() === lastSingleKey.toLowerCase() &&
      !items[0]!.suppress;

    let parts: Array<string | { __html: string }>;
    if (sameAsPrev) {
      const loc = items[0]!.locator ? `, ${esc(items[0]!.locator)}` : "";
      parts = [{ __html: `<i>ibid.</i>${loc}` }];
    } else {
      parts = items.map(it => {
        if (!it.entry) return `@${it.key}${it.locator ? `, ${it.locator}` : ""}`;

        const year = it.entry.entryTags.year || "n.d.";
        const a = (() => {
          const list = (it.entry!.entryTags.author || "")
            .split(/\s+and\s+/i).map(s => s.trim()).filter(Boolean);
          const ln = (full: string) => (/,/.test(full) ? full.split(",")[0]!.trim()
            : (full.trim().split(/\s+/).pop() || full.trim()));
          if (!list.length) return "Unknown";
          if (list.length === 1) return ln(list[0]!);
          return `${ln(list[0]!)} et al.`;
        })();

        if (it.suppress) return `${year}${it.locator ? `, ${it.locator}` : ""}`;
        return `${a}, ${year}${it.locator ? `, ${it.locator}` : ""}`;
      });
    }

    const anchor = items.find(it => it.entry)?.key || (inside.match(/@([A-Za-z0-9_/:.\-]+)/)?.[1] ?? "");
    const inner = parts.map(p => (typeof p === "string" ? esc(p) : p.__html)).join("; ");

    lastSingleKey = isSingle ? items[0]!.key : null;

    // Parentheses outside anchor so underline doesn't cover '(' or ')'
    // 앵커는 속성 이스케이프를 적용
    return `(<a class="citation" href="#ref-${esc(anchor)}">${inner}</a>)`;
  });

  return { text: out, usedKeys: used };
}

/* ─────────────────────────────────────────────────────────────
 *  Bibliography formatters
 * ──────────────────────────────────────────────────────────── */
function fmtEntryHarvard(e: BibEntry): string {
  const t = e.entryTags;
  const year = t.year || "n.d.";
  const title = t.title ? tidyBibText(t.title) : "";
  const journal = t.journal ? tidyBibText(t.journal) : "";
  const booktitle = t.booktitle ? tidyBibText(t.booktitle) : "";
  const publisher = t.publisher ? tidyBibText(t.publisher) : "";
  const address = t.address ? tidyBibText(t.address) : "";
  const howpub = t.howpublished ? tidyBibText(t.howpublished) : "";

  const authors = splitAuthors(t.author);
  const editors = splitAuthors(t.editor);
  const who = authors.length ? joinNameList(authors) : (editors.length ? joinNameList(editors) + " (eds.)" : "Unknown");
  const doi = t.doi ? ` https://doi.org/${esc(t.doi)}` : "";
  const url = (!t.doi && t.url) ? ` ${esc(t.url)}` : "";

  switch (e.entryType) {
    case "article": {
      const j = journal ? `<i>${esc(journal)}</i>` : "";
      const vol = t.volume ? ` ${esc(t.volume)}` : "";
      const no = t.number ? `(${esc(t.number)})` : "";
      const pg = t.pages ? `: ${esc(fmtPages(t.pages))}` : "";
      return `${esc(who)} (${esc(year)}). ${esc(title)}. ${j}${vol}${no}${pg}.${doi || url}`;
    }
    case "book": {
      return `${esc(who)} (${esc(year)}). <i>${esc(title)}</i>. ${esc(publisher)}${address ? `, ${esc(address)}` : ""}.${doi || url}`;
    }
    case "inproceedings":
    case "incollection": {
      const book = booktitle ? `<i>${esc(booktitle)}</i>` : "";
      const pg = t.pages ? `, pp. ${esc(fmtPages(t.pages))}` : "";
      const pub = publisher ? `. ${esc(publisher)}` : "";
      return `${esc(who)} (${esc(year)}). ${esc(title)}. In ${book}${pg}${pub}.${doi || url}`;
    }
    case "phdthesis":
    case "mastersthesis": {
      const sch = t.school ? tidyBibText(t.school) : "";
      return `${esc(who)} (${esc(year)}). <i>${esc(title)}</i>. ${esc(sch)}.${doi || url}`;
    }
    default: {
      const how = howpub ? `${esc(howpub)}. ` : "";
      return `${esc(who)} (${esc(year)}). ${esc(title)}. ${how}${doi || url}`;
    }
  }
}

function fmtEntryChicago(e: BibEntry): string {
  const t = e.entryTags;
  const year = t.year || "n.d.";
  const title = t.title ? tidyBibText(t.title) : "";
  const journal = t.journal ? tidyBibText(t.journal) : "";
  const booktitle = t.booktitle ? tidyBibText(t.booktitle) : "";
  const publisher = t.publisher ? tidyBibText(t.publisher) : "";
  const address = t.address ? tidyBibText(t.address) : "";
  const howpub = t.howpublished ? tidyBibText(t.howpublished) : "";

  const authors = splitAuthors(t.author);
  const editors = splitAuthors(t.editor);
  const who = authors.length ? joinNameList(authors) : (editors.length ? joinNameList(editors) + " (eds.)" : "Unknown");
  const doi = t.doi ? ` https://doi.org/${esc(t.doi)}` : "";
  const url = (!t.doi && t.url) ? ` ${esc(t.url)}` : "";

  switch (e.entryType) {
    case "article": {
      const j = journal ? `<i>${esc(journal)}</i>` : "";
      const vol = t.volume ? ` ${esc(t.volume)}` : "";
      const no = t.number ? `(${esc(t.number)})` : "";
      const pg = t.pages ? `: ${esc(fmtPages(t.pages))}` : "";
      return `${esc(who)}. ${esc(year)}. “${esc(title)}.” ${j}${vol}${no}${pg}.${doi || url}`;
    }
    case "book": {
      const addr = address ? `: ${esc(address)}` : "";
      return `${esc(who)}. ${esc(year)}. <i>${esc(title)}</i>.${addr ? addr : ""}${addr ? "" : (publisher ? ` ${esc(publisher)}.` : ".")}${doi || url}`;
    }
    case "inproceedings":
    case "incollection": {
      const book = booktitle ? `<i>${esc(booktitle)}</i>` : "";
      const pg = t.pages ? `, ${esc(fmtPages(t.pages))}` : "";
      const pub = publisher ? `. ${esc(publisher)}` : "";
      return `${esc(who)}. ${esc(year)}. “${esc(title)}.” In ${book}${pg}${pub}.${doi || url}`;
    }
    default: {
      return `${esc(who)}. ${esc(year)}. ${esc(title)}.${howpub ? " " + esc(howpub) + "." : ""}${doi || url}`;
    }
  }
}

function fmtEntryApaLite(e: BibEntry): string {
  const t = e.entryTags;
  const year = t.year || "n.d.";
  const title = t.title ? tidyBibText(t.title) : "";
  const journal = t.journal ? tidyBibText(t.journal) : "";
  const booktitle = t.booktitle ? tidyBibText(t.booktitle) : "";
  const publisher = t.publisher ? tidyBibText(t.publisher) : "";
  const howpub = t.howpublished ? tidyBibText(t.howpublished) : "";

  const authors = splitAuthors(t.author);
  const editors = splitAuthors(t.editor);
  const who = authors.length ? authorsApa(authors) : (editors.length ? authorsApa(editors) + " (Eds.)" : "Unknown");
  const doi = t.doi ? ` https://doi.org/${esc(t.doi)}` : "";
  const url = (!t.doi && t.url) ? ` ${esc(t.url)}` : "";

  switch (e.entryType) {
    case "article": {
      const j = journal ? `<i>${esc(journal)}</i>` : "";
      const vol = t.volume ? `, ${esc(t.volume)}` : "";
      const no = t.number ? `(${esc(t.number)})` : "";
      const pg = t.pages ? `, ${esc(fmtPages(t.pages))}` : "";
      return `${who} (${esc(year)}). ${esc(title)}. ${j}${vol}${no}${pg}.${doi || url}`;
    }
    case "book": {
      return `${who} (${esc(year)}). <i>${esc(title)}</i>. ${esc(publisher)}.${doi || url}`;
    }
    case "inproceedings":
    case "incollection": {
      const book = booktitle ? `<i>${esc(booktitle)}</i>` : "";
      const pg = t.pages ? ` (pp. ${esc(fmtPages(t.pages))})` : "";
      const pub = publisher ? `. ${esc(publisher)}` : "";
      return `${who} (${esc(year)}). ${esc(title)}. In ${book}${pg}${pub}.${doi || url}`;
    }
    default: {
      return `${who} (${esc(year)}). ${esc(title)}.${howpub ? " " + esc(howpub) + "." : ""}${doi || url}`;
    }
  }
}

function pickFormatter(style = "harvard"): (e: BibEntry) => string {
  const s = String(style || "").toLowerCase();
  if (s === "harvard") return fmtEntryHarvard;
  if (s === "chicago" || s === "author-date" || s === "chicago-author-date") return fmtEntryChicago;
  if (s === "apa") return fmtEntryApaLite;
  return fmtEntryHarvard;
}

function generateBibliographyHtml(entries: BibEntry[], style = "harvard"): string {
  if (!entries.length) return "";
  const fmt = pickFormatter(style);
  const items = entries.map(e => `<li id="ref-${esc(e.citationKey)}">${fmt(e)}</li>`).join("\n");

  return `
  <section class="bibliography footnotes" role="doc-bibliography" aria-labelledby="bib-h">
  <h3 id="bib-h"><strong>Bibliography</strong></h3>
  <div class="bib-block">
    ${items}
  </ul>
  </section>`;
}



/* ─────────────────────────────────────────────────────────────
 *  Orchestrator
 * ──────────────────────────────────────────────────────────── */
export async function processBib(markdown: string, bibUrl: string, opts: ProcessBibOptions = {}): Promise<ProcessBibResult> {
  const style = opts.style || "harvard";
  const usageHelp = opts.usageHelp !== false; // default true
  const ibid = opts.ibid !== false;          // default true

  const bibText = await fetchBibFile(bibUrl);
  const parsed = parseBibTeX(bibText);

  // case-insensitive map
  const map = new Map<string, BibEntry>();
  for (const e of parsed) {
    map.set(e.citationKey, e);
    map.set(String(e.citationKey).toLowerCase(), e);
  }

  const { text: withCites, usedKeys } = replaceCitations(markdown, map, { ibid });
  const usedEntries = usedKeys
    .map((k) => map.get(k) || map.get(String(k).toLowerCase()))
    .filter((v): v is BibEntry => !!v);
  const bibliographyHtml = generateBibliographyHtml(usedEntries, style);

  const allKeys = parsed.map(e => e.citationKey);
  return { content: withCites, bibliographyHtml, usedKeys, allKeys };
}

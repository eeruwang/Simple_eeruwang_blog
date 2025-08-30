// lib/util.ts
/* ───────── 공통 유틸 ─────────
 * - escapeHtml / escapeAttr / escapeXml
 * - withBibliography (본문 끝에 참고문헌 섹션 주입)
 * - json / slugifyForApi
 * - whereExpr (@deprecated: NocoDB 시절 호환)
 */

export function escapeHtml(s: string = ""): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as const)[c]!
  );
}

/** HTML 속성 값 이스케이프 */
export function escapeAttr(s: string = ""): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as const)[c]!
  );
}

export function escapeXml(s: string = ""): string {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" } as const)[c]!
  );
}

/** 본문 하단에 bibliographyHtml을 주입(중복 방지 + 안전 폴백) */
// lib/util.ts
// lib/util.ts
export async function withBibliography(resp: Response, bibliographyHtml?: string): Promise<Response> {
  if (!bibliographyHtml || !bibliographyHtml.trim()) return resp;

  const ct = resp.headers.get("content-type") || "";
  if (!/text\/html\b/i.test(ct)) return resp;

  const html = await resp.text();

  // 이미 bibliography 섹션이 있으면 중복 주입 금지
  if (/\bclass\s*=\s*["'][^"']*\bbibliography\b/i.test(html)) {
    return new Response(html, { status: resp.status, headers: resp.headers });
  }

  let patched = html;

  // 1) 첫 번째 footnotes 섹션 '뒤'에 삽입
  const footnotesRe =
    /(<section[^>]*class=["'][^"']*\bfootnotes\b[^"']*["'][^>]*>[\s\S]*?<\/section>)/i;

  if (footnotesRe.test(patched)) {
    patched = patched.replace(footnotesRe, `$1\n${bibliographyHtml}`);
  } else {
    // 2) 사이트 푸터 시작 직전
    const beforeFooter = /(<footer[\s>][\s\S]*?>)/i;
    if (beforeFooter.test(patched)) {
      patched = patched.replace(beforeFooter, `${bibliographyHtml}\n$1`);
    } else {
      // 3) 최후 폴백: </body> 직전
      patched = patched.replace(/<\/body>/i, `${bibliographyHtml}\n</body>`);
    }
  }

  const headers = new Headers(resp.headers);
  if (!headers.get("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }
  return new Response(patched, { status: resp.status, headers });
}



export type WhereValue = string | number | boolean | null | undefined;

/** @deprecated NocoDB 전용 헬퍼. Postgres 전환 후에는 사용하지 마세요. */
export function whereExpr(field: string, op: string, v: WhereValue): string {
  const val =
    typeof v === "string" ? `"${String(v).replace(/"/g, '\\"')}"` : v == null ? "null" : String(v);
  return `(${field},${op},${val})`;
}

export function json(obj: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function slugifyForApi(s: string | null | undefined): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

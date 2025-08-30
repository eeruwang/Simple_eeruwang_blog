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
export async function withBibliography(resp: Response, bibliographyHtml?: string): Promise<Response> {
  if (!bibliographyHtml || !bibliographyHtml.trim()) return resp;

  const ct = resp.headers.get("content-type") || "";
  if (!/text\/html\b/i.test(ct)) return resp;

  const html = await resp.text();

  // 이미 bibliography 섹션이 있으면 주입 생략
  if (/\bclass\s*=\s*["'][^"']*\bbibliography\b/i.test(html)) {
    return new Response(html, { status: resp.status, headers: resp.headers });
  }

  // 우선순위: </main> → </article> → </body> → (없으면 맨 끝)
  let patched = html;
  const tryInsert = (re: RegExp) => {
    const next = patched.replace(re, `${bibliographyHtml}\n$&`);
    const changed = next !== patched;
    patched = next;
    return changed;
  };

  if (!tryInsert(/<\/main>\s*<\/body>/i)) {
    if (!tryInsert(/<\/article>\s*<\/body>/i)) {
      if (!tryInsert(/<\/body>/i)) {
        patched = patched + `\n${bibliographyHtml}`;
      }
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

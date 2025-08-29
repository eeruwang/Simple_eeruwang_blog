// lib/util.ts
/* ───────── 공통 유틸 ─────────
 * - escapeHtml / escapeAttr / escapeXml
 * - whereExpr (NocoDB 전용, @deprecated)
 * - json
 * - slugifyForApi
 */

export function escapeHtml(s: string = ""): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as const)[c]!
  );
}

export function escapeAttr(s: string = ""): string {
  // HTML 속성에 쓰일 값: &, <, >, ", ' 모두 이스케이프
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&quot;amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as const)[c]!
  );
}

export function escapeXml(s: string = ""): string {
  return String(s).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" } as const)[c]!
  );
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

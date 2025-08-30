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
export async function withBibliography(resp: Response, bibliographyHtml?: string): Promise<Response> {
  if (!bibliographyHtml || !bibliographyHtml.trim()) return resp;

  const ct = resp.headers.get("content-type") || "";
  if (!/text\/html\b/i.test(ct)) return resp;

  const html = await resp.text();

  // 이미 bibliography 섹션이 있으면 중복 주입 안 함
  if (/\bclass\s*=\s*["'][^"']*\bbibliography\b/i.test(html)) {
    return new Response(html, { status: resp.status, headers: resp.headers });
  }

  // ── 주입 앵커 우선순위 ──
  // 1) 명시적 플레이스홀더 (있으면 여기에)
  // 2) </main> 바로 앞 (본문 영역 끝: 각주 뒤일 가능성 높음)
  // 3) </article> 바로 앞 (본문이 article일 때)
  // 4) <footer …> 바로 앞 (사이트 푸터 시작 직전)
  // 5) </body> 직전 (최후 폴백)
  const anchors: RegExp[] = [
    /<!--\s*__BIB_HERE__\s*-->/i,
    /<\/main>/i,
    /<\/article>/i,
    /<footer[\s>][\s\S]*?>/i,
    /<\/body>/i,
  ];

  let patched = html;
  let inserted = false;
  for (const re of anchors) {
    const next = patched.replace(re, `${bibliographyHtml}\n$&`);
    if (next !== patched) {
      patched = next;
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    patched += `\n${bibliographyHtml}`;
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

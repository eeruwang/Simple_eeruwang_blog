// lib/util.ts
/* ───────── 공통 유틸 ─────────
 * - escapeHtml / escapeAttr / escapeXml
 * - withBibliography (본문 끝에 참고문헌 섹션 주입)
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

  let html = await resp.text();

  // 이미 붙어 있으면 중복 방지
  if (/\bclass\s*=\s*["'][^"']*\bbibliography\b/i.test(html)) {
    return new Response(html, { status: resp.status, headers: resp.headers });
  }

  // 0) 명시적 앵커가 있으면 그 자리에 정확히 삽입 (전환 컨테이너 안)
  const markerRe = /<!--\s*__BIB_HERE__\s*-->/i;
  if (markerRe.test(html)) {
    html = html.replace(markerRe, bibliographyHtml);
  } else {
    // 1) 풋노트 섹션 바로 '뒤'에 삽입 (컨테이너 안일 가능성 높음)
    const footnotesRe = /(<section[^>]*class=["'][^"']*\bfootnotes\b[^"']*["'][^>]*>[\s\S]*?<\/section>)/i;
    if (footnotesRe.test(html)) {
      html = html.replace(footnotesRe, `$1\n${bibliographyHtml}`);
    } else {
      // 2) 사이트 푸터 시작 직전
      const beforeFooter = /(<footer[\s>][\s\S]*?>)/i;
      if (beforeFooter.test(html)) {
        html = html.replace(beforeFooter, `${bibliographyHtml}\n$1`);
      } else {
        // 3) 최후: </body> 직전
        html = html.replace(/<\/body>/i, `${bibliographyHtml}\n</body>`);
      }
    }
  }

  const headers = new Headers(resp.headers);
  if (!headers.get("content-type")) {
    headers.set("content-type", "text/html; charset=utf-8");
  }
  return new Response(html, { status: resp.status, headers });
}

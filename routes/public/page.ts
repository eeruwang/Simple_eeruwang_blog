// src/routes/public/page.ts
/* ───────── 페이지 라우트 (Postgres 버전) ─────────
 * - /:slug 에서 is_page=true 인 레코드를 Postgres에서 조회
 * - views/pageview.js 의 renderPostPage 로 렌더
 */

import { getPageBySlug } from "../../lib/db/db.js";
import { renderPostPage } from "../../views/pageview.js"; // 경로는 프로젝트 구조에 맞게 유지

type Env = Record<string, unknown>;

export async function renderPage(
  env: Env,
  slug: string,
  searchParams?: URLSearchParams
): Promise<Response> {
  const s = decodeURIComponent(String(slug || "").trim());
  if (!s) return new Response("Not found", { status: 404 });

  // debug=1 이면 draft 페이지도 미리보기 허용
  const debug = !!searchParams?.get?.("debug");

  try {
    const rec = await getPageBySlug(s, { includeDraft: debug });
    if (!rec) {
      return new Response("Not found", { status: 404 });
    }

    // 기존 시그니처 유지: renderPostPage(env, record, debug)
    return await renderPostPage(env as any, rec as any, debug);
  } catch (e: any) {
    console.error("[page] render error:", e);
    return new Response("Server error", { status: 500 });
  }
}

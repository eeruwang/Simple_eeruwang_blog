// src/routes/public/page.ts
/* ───────── 페이지 라우트 (Postgres 버전) ─────────
 * - /:slug 에서 is_page=true 인 레코드를 Postgres에서 조회
 * - views/pageview.js 의 renderPostPage 로 렌더
 */

import { getPageBySlug } from "../../lib/db/db.js";
import { renderPostPage } from "../../views/pageview.js";

type Env = Record<string, unknown>;

const toBool = (v: unknown) =>
  v === true || v === 1 || v === "1" || v === "t" || v === "true";

export async function renderPage(
  env: Env,
  slug: string,
  searchParams?: URLSearchParams
): Promise<Response> {
  const s = String(slug || "").trim();
  if (!s) return new Response("Not found", { status: 404 });

  const debug = !!searchParams?.get?.("debug");

  // ✅ 페이지 전용 조회
const includeDraft =
  searchParams?.get?.("draft") === "1" ||
  searchParams?.get?.("preview") === "1" ||
  searchParams?.get?.("debug") === "1";
const rec = await getPageBySlug(s, { includeDraft });
  if (!rec || !toBool((rec as any).is_page)) {
    return new Response("Not found", { status: 404 });
  }

  return await renderPostPage(env, rec as any, debug);
}

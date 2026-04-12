// lib/db/db.ts
/* Cross-runtime database client:
 * - NocoDB(REST API): NOCODB_HOST 설정 시 사용
 * - Vercel/Neon(serverless): @neondatabase/serverless (fetch 기반)
 * - Docker/Node: pg Pool (TCP)
 *
 * 선택 규칙
 * 0) NOCODB_HOST + NOCODB_API_KEY + NOCODB_TABLE_ID 가 있으면 NocoDB
 * 1) process.env.NEON_DATABASE_URL 가 있으면 네온 드라이버 사용
 * 2) 아니면 process.env.DATABASE_URL 사용
 * 3) URL에 'neon.tech' 포함되면 네온 드라이버 강제
 * 4) 그 외엔 pg Pool
 */

import * as nocodb from "./nocodb.js";

// NocoDB 모드 감지
const useNocoDB = !!(
  process.env.NOCODB_HOST &&
  process.env.NOCODB_API_KEY &&
  process.env.NOCODB_TABLE_ID
);

if (useNocoDB) {
  console.log("[db] NocoDB mode enabled →", process.env.NOCODB_HOST);
}

export type PostRow = {
  id: number;
  slug: string;
  title: string;
  body_md: string;
  cover_url: string | null;
  excerpt: string | null;
  tags: string[] | null;
  is_page: boolean;
  published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

// 쿼리 결과: 단순 배열 (이전 버전은 Array.prototype에 .rows 게터를 주입했으나,
// 전역 원형 오염 방지를 위해 제거했습니다.)
type Queryable = {
  query<T = unknown>(text: string, params?: any[]): Promise<T[]>;
  end?: () => Promise<void>;
};

// -------- URL / 드라이버 판별 --------
// 수정 (항상 DATABASE_URL을 먼저 봄 — 너의 배포 환경과 일치)
const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "";


if (!DATABASE_URL) {
  // 일부 스크립트는 import만 하고 안 쓰는 경우가 있어 throw는 하지 않음
  console.warn("[db] DATABASE_URL/NEON_DATABASE_URL is not set");
}

const looksLikeNeon =
  !!process.env.NEON_DATABASE_URL ||
  /neon\.tech/i.test(DATABASE_URL) ||
  process.env.PG_DRIVER === "neon";

function shouldEnableSSL(url: string): boolean {
  // 매니지드 서비스 대부분 SSL 필요
  return /neon\.tech|supabase\.co|amazonaws\.com|herokuapp\.com/i.test(url);
}

// -------- 클라이언트 생성 (lazy & singleton) --------
let clientPromise: Promise<Queryable> | null = null;

async function createClient(): Promise<Queryable> {
  if (!DATABASE_URL) {
    throw new Error("[db] DATABASE_URL is missing");
  }

  if (looksLikeNeon) {
    // 서버리스/엣지 친화: fetch 기반 드라이버.
    // @neondatabase/serverless는 `sql.query(text, params)`를 통해 파라미터
    // 바인딩된 쿼리를 실행합니다. 이전에는 존재하지 않는 `.unsafe` 메서드를
    // 호출했는데, 그 경로를 수정합니다. 반환값은 버전에 따라 배열 또는
    // `{ rows }`일 수 있어 양쪽을 모두 처리합니다.
    const { neon } = await import("@neondatabase/serverless");
    const sql: any = neon(DATABASE_URL);

    const query = async <T = unknown>(text: string, params: any[] = []): Promise<T[]> => {
      const result: any = await sql.query(text, params);
      if (Array.isArray(result)) return result as T[];
      if (result && Array.isArray(result.rows)) return result.rows as T[];
      return [];
    };

    return { query };
  } else {
    // Node TCP 풀 (Docker/서버)
    const { Pool } = await import("pg");
    const g = globalThis as unknown as { __pgPool?: InstanceType<typeof Pool> };
    if (!g.__pgPool) {
      g.__pgPool = new Pool({
        connectionString: DATABASE_URL,
        max: Number(process.env.PG_POOL_MAX || 5),
        ssl: shouldEnableSSL(DATABASE_URL) ? { rejectUnauthorized: false } : undefined,
      });
      g.__pgPool.on("error", (err) => {
        console.error("[pg] unexpected error on idle client", err);
      });
    }
    const pool = g.__pgPool;

    const query: Queryable["query"] = async (text, params) => {
      const res = await pool.query(text, params);
      return res.rows as any[];
    };

    const end: Queryable["end"] = async () => {
      await pool.end().catch(() => {});
      g.__pgPool = undefined;
    };

    return { query, end };
  }
}

async function getClient(): Promise<Queryable> {
  clientPromise ??= createClient();
  return clientPromise;
}

export async function query<T = unknown>(text: string, params?: any[]) {
  const client = await getClient();
  return client.query<T>(text, params); // 반환: Rows<T> (배열 + .rows)
}

// 작은 유틸
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function pageOffset(page = 1, perPage = 10) {
  const p = clamp((page as number) | 0, 1, 1_000_000);
  const take = clamp((perPage as number) | 0, 1, 200);
  return { take, offset: (p - 1) * take };
}

// 드라이버 확인용
export function driverKind() {
  if (useNocoDB) return "nocodb";
  return looksLikeNeon ? "neon" : "pg";
}

// 객체/배열 혼용 결과를 배열로 보정
export function asArrayRows<T>(res: any): T[] {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.rows)) return res.rows;
  if (res && Array.isArray(res.data)) return res.data;
  return [];
}

// DB 헬스체크
export async function pingDb() {
  if (useNocoDB) return nocodb.pingDb();
  const rows = await query<{ now: string }>("select now() as now");
  return { now: rows[0]?.now };
}

// -------- 고수준 API --------

/** 목록(게시글만) */
export async function listPosts(page = 1, perPage = 10): Promise<PostRow[]> {
  if (useNocoDB) return nocodb.listPosts(page, perPage);
  const { take, offset } = pageOffset(page, perPage);
  const rows = await query<PostRow>(
    `
    select *
    from posts
    where published = true and coalesce(is_page,false) = false
    order by published_at desc nulls last, updated_at desc nulls last, id desc
    limit $1 offset $2
    `,
    [take, offset]
  );
  return rows;
}

/** 태그별 목록 */
export async function listByTag(tag: string, page = 1, perPage = 10): Promise<PostRow[]> {
  if (useNocoDB) return nocodb.listByTag(tag, page, perPage);
  const { take, offset } = pageOffset(page, perPage);
  const rows = await query<PostRow>(
    `
    select *
    from posts
    where published = true
      and coalesce(is_page,false) = false
      and $1 = any(tags)
    order by published_at desc nulls last, updated_at desc nulls last, id desc
    limit $2 offset $3
    `,
    [tag, take, offset]
  );
  return rows;
}

/** 슬러그로 조회(포스트/페이지 공용) */
export async function getBySlug(slug: string): Promise<PostRow | null> {
  if (useNocoDB) return nocodb.getBySlug(slug);
  const rows = await query<PostRow>(
    `select * from posts where lower(slug) = lower($1) limit 1`,
    [slug]
  );
  return rows[0] || null;
}

/** 페이지 전용: slug로 조회 (published만, 옵션으로 draft 포함) */
export async function getPageBySlug(
  slug: string,
  opts?: { includeDraft?: boolean }
): Promise<PostRow | null> {
  if (useNocoDB) return nocodb.getPageBySlug(slug, opts);
  const includeDraft = !!opts?.includeDraft;
  const rows = await query<PostRow>(
    `
    select *
    from posts
    where lower(slug) = lower($1)
      and coalesce(is_page, false) = true
      and (published = true or $2::boolean = true)
    order by published_at desc nulls last, updated_at desc nulls last, id desc
    limit 1
    `,
    [slug, includeDraft]
  );
  return rows[0] || null;
}

/** (선택) 포스트 전용 */
export async function getPostBySlug(
  slug: string,
  opts?: { includeDraft?: boolean }
): Promise<PostRow | null> {
  if (useNocoDB) return nocodb.getPostBySlug(slug, opts);
  const includeDraft = !!opts?.includeDraft;
  const rows = await query<PostRow>(
    `
    select *
    from posts
    where lower(slug) = lower($1)
      and coalesce(is_page, false) = false
      and (published = true or $2::boolean = true)
    order by published_at desc nulls last, updated_at desc nulls last, id desc
    limit 1
    `,
    [slug, includeDraft]
  );
  return rows[0] || null;
}

/** 공개 포스트 태그 전부 (distinct + 정렬) */
export async function listAllTags(): Promise<string[]> {
  if (useNocoDB) return nocodb.listAllTags();
  try {
    const rows = await query<{ tag: string }>(
      `select distinct unnest(tags) as tag from posts
       where published = true and (is_page = false or is_page is null)
       order by tag asc`
    );
    return rows.map((r) => String(r.tag || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 인덱스용: 페이지 단위로 포스트를 가져오면서 다음 페이지 존재 여부를 같이 계산.
 * `perPage + 1`개를 조회해 look-ahead로 hasNext를 판단합니다.
 */
export async function listPostsPaged(
  page = 1,
  perPage = 10
): Promise<{ items: PostRow[]; hasNext: boolean }> {
  const rows = await listPosts(page, perPage + 1);
  const hasNext = rows.length > perPage;
  return { items: rows.slice(0, perPage), hasNext };
}


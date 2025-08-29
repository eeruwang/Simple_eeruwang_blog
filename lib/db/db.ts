// lib/db/db.ts
/* Cross-runtime Postgres client:
 * - Vercel/Neon(serverless): @neondatabase/serverless
 * - Docker/Node: pg Pool
 *
 * 선택 규칙
 * 1) process.env.NEON_DATABASE_URL 가 있으면 네온 드라이버 사용
 * 2) 아니면 process.env.DATABASE_URL 사용
 * 3) URL에 'neon.tech' 포함되면 네온 드라이버 강제
 * 4) 그 외엔 pg Pool
 */

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

// 배열이면서 .rows도 가진 타입 (두 패턴 모두 호환)
type Rows<T> = T[] & { rows: T[] };

type Queryable = {
  query<T = unknown>(text: string, params?: any[]): Promise<Rows<T>>;
  end?: () => Promise<void>;
};

// -------- URL / 드라이버 판별 --------
const DATABASE_URL =
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "";

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
    // 서버리스/엣지 친화: fetch 기반 드라이버
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(DATABASE_URL);

    // Array params를 받는 query 래퍼 제공 (배열 + .rows 둘 다 제공)
    const query = async <T = unknown>(text: string, params: any[] = []) => {
      const arr = (await (sql as any).unsafe(text, params)) as T[];
      (arr as any).rows = arr;
      return arr as Rows<T>;
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
      const arr = res.rows as any[];
      (arr as any).rows = arr;
      return arr as Rows<any>;
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
  return client.query<T>(text, params); // 반환: Rows<T>
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

// DB 헬스체크
export async function pingDb() {
  const rows = await query<{ now: string }>("select now() as now");
  return { now: rows[0]?.now };
}

// -------- 고수준 API --------

/** 목록(게시글만) */
export async function listPosts(page = 1, perPage = 10): Promise<PostRow[]> {
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
  const rows = await query<PostRow>(
    `select * from posts where slug = $1 limit 1`,
    [slug]
  );
  return rows[0] || null;
}

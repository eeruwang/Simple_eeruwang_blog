// lib/db/bootstrap.ts
import { Pool, PoolConfig } from "pg";

/** 공용 Env 스키마(필요한 키들만) */
export type Env = {
  DATABASE_URL?: string;
  NEON_DATABASE_URL?: string;
  [k: string]: unknown;
};

export type QueryResult<T = any> = { rows: T[] };

export type DB = {
  query: (sql: string, params?: any[]) => Promise<QueryResult>;
  tx: <T>(fn: (q: { query: DB["query"] }) => Promise<T>) => Promise<T>;
};

// ─────────────────────────────────────────────────────────────
// 내부 싱글톤 풀(모듈당 1개)
// ─────────────────────────────────────────────────────────────
let pool: Pool | null = null;

function sslOption(u: string): PoolConfig["ssl"] {
  const needSSL =
    /neon\.tech|supabase\.co|amazonaws\.com|herokuapp\.com/i.test(u) ||
    /sslmode=require/i.test(u);
  return needSSL ? { rejectUnauthorized: false } : undefined;
}

function resolveDbUrl(envOrUrl: Env | string): string {
  if (typeof envOrUrl === "string") return envOrUrl;
  return (
    envOrUrl.DATABASE_URL ||
    process.env.DATABASE_URL ||
    envOrUrl.NEON_DATABASE_URL ||
    (process.env as any).NEON_DATABASE_URL ||
    ""
  );
}

/** 커넥션 풀 생성 + 쿼리/트랜잭션 래퍼 제공 */
export function createDb(envOrUrl: Env | string): DB {
  const url = resolveDbUrl(envOrUrl);
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 5,
      ssl: sslOption(url),
    });
  }

  const query: DB["query"] = async (sql, params = []) => {
    const res = await pool!.query(sql, params);
    return { rows: res.rows };
  };

  const tx: DB["tx"] = async (fn) => {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const q = async (sql: string, params: any[] = []) => {
        const r = await client.query(sql, params);
        return { rows: r.rows };
      };
      const out = await fn({ query: q as any });
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      client.release();
    }
  };

  return { query, tx };
}

/** 스키마/트리거 보증(있으면 NOOP) */
export async function bootstrapDb(db: DB): Promise<void> {
  const ddl = `
  create table if not exists posts (
    id            bigserial primary key,
    slug          text not null unique,
    title         text not null,
    body_md       text not null,
    cover_url     text,
    excerpt       text,
    tags          text[] default '{}'::text[],
    is_page       boolean default false,
    published     boolean default false,
    published_at  timestamptz,
    created_at    timestamptz default now(),
    updated_at    timestamptz default now()
  );

  create index if not exists idx_posts_published_at
  on posts (published desc, published_at desc nulls last, updated_at desc nulls last, id desc);

  create or replace function set_updated_and_published_at() returns trigger as $$
  begin
    new.updated_at = now();
    if (new.published = true
        and (old.published is distinct from new.published)
        and new.published_at is null) then
      new.published_at = now();
    end if;
    return new;
  end $$ language plpgsql;

  drop trigger if exists trg_posts_set_updated on posts;
  create trigger trg_posts_set_updated
  before update on posts
  for each row execute procedure set_updated_and_published_at();

  -- 🔧 설정 저장소
  create table if not exists app_settings(
    k text primary key,
    v text not null,
    updated_at timestamptz default now()
  );
  create or replace function set_settings_updated() returns trigger as $$
  begin
    new.updated_at = now();
    return new;
  end $$ language plpgsql;
  drop trigger if exists trg_app_settings_updated on app_settings;
  create trigger trg_app_settings_updated
  before update on app_settings
  for each row execute procedure set_settings_updated();
  `;
  await db.tx(async ({ query }) => { await query(ddl); });
}

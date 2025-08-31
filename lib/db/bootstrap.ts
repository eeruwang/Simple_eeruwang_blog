// lib/db/bootstrap.ts
import { Pool } from "pg";

export type Env = {
  DATABASE_URL?: string;
  NEON_DATABASE_URL?: string;
  EDITOR_PASSWORD?: string;
  SITE_URL?: string;
  BLOB_READ_WRITE_TOKEN?: string;
  [k: string]: unknown;
};

export type QueryResult<T = any> = { rows: T[] };

export type DB = {
  query: (sql: string, params?: any[]) => Promise<QueryResult>;
  tx: <T>(fn: (q: { query: DB["query"] }) => Promise<T>) => Promise<T>;
};

let pool: Pool | null = null;

function sslNeeded(u: string): boolean {
  return /neon\.tech|supabase\.co|amazonaws\.com|herokuapp\.com/i.test(u) || /sslmode=require/i.test(u);
}

export function createDb(env: Env): DB {
  const url =
    (env.DATABASE_URL as string | undefined) ||
    (process.env.DATABASE_URL as string | undefined) ||
    (env.NEON_DATABASE_URL as string | undefined) ||
    ((process.env as any).NEON_DATABASE_URL as string | undefined) ||
    "";

  if (!url) throw new Error("DATABASE_URL is not set");

  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 5,
      ssl: sslNeeded(url) ? { rejectUnauthorized: false } : undefined,
    });
  }

  const query: DB["query"] = async (sql, params = []) => {
    const r = await pool!.query(sql, params);
    return { rows: r.rows };
  };

  const tx: DB["tx"] = async (fn) => {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const q: DB["query"] = async (sql, params = []) => {
        const r = await client.query(sql, params);
        return { rows: r.rows };
      };
      const out = await fn({ query: q });
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

// lib/db/bootstrap.ts
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolConfig, QueryResult } from "pg";
import { Pool } from "pg";

export type Env = {
  DATABASE_URL?: string;
  [k: string]: unknown;
};

export type DB = {
  // pg와 동일한 시그니처로 사용
  query(text: string, params?: any[]): Promise<QueryResult>;
  // 트랜잭션 유틸
  tx<T>(fn: (c: { query: DB["query"] }) => Promise<T>): Promise<T>;
};

const pools = new Map<string, Pool>();

function sslOption(u: string): PoolConfig["ssl"] {
  const needSSL =
    /neon\.tech|supabase\.co|amazonaws\.com|herokuapp\.com/i.test(u) ||
    /sslmode=require/i.test(u);
  return needSSL ? { rejectUnauthorized: false } : undefined;
}

function getPool(dbUrlRaw: unknown): Pool {
  const dbUrl = String(dbUrlRaw || "").trim();
  if (!dbUrl) throw new Error("DATABASE_URL is not set (empty)");
  if (!/^postgres(ql)?:\/\//i.test(dbUrl)) {
    throw new Error(
      `DATABASE_URL must start with "postgres://" or "postgresql://"\nGot: ${dbUrl.split("@").at(-1)}`
    );
  }
  const key = dbUrl;
  let p = pools.get(key);
  if (!p) {
    p = new Pool({ connectionString: dbUrl, ssl: sslOption(dbUrl) });
    pools.set(key, p);
  }
  return p;
}

export function createDb(env: Env): DB {
  const pool = getPool((env as any).DATABASE_URL ?? process.env.DATABASE_URL);

  async function query(text: string, params?: any[]): Promise<QueryResult> {
    return pool.query(text, params);
  }

  async function tx<T>(fn: (c: { query: DB["query"] }) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await fn({
        // 여기서도 타입 통일(제네릭 없이)
        query: (text: string, params?: any[]) => client.query(text, params),
      });
      await client.query("COMMIT");
      return res;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      throw e;
    } finally {
      client.release();
    }
  }

  return { query, tx };
}


// ───────── schema/seed 실행
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function firstExistingPath(...paths: string[]): string | null {
  for (const p of paths) if (existsSync(p)) return p;
  return null;
}

export async function bootstrapDb(db: DB): Promise<void> {
  const schemaPath =
    firstExistingPath(
      path.resolve(__dirname, "schema.sql"),
      path.resolve(process.cwd(), "lib/db/schema.sql"),
      path.resolve(process.cwd(), "db/schema.sql"),
    ) ?? undefined;

  if (!schemaPath) throw new Error("schema.sql not found under lib/db or db/");

  const seedPath =
    firstExistingPath(
      path.resolve(__dirname, "seed.sql"),
      path.resolve(process.cwd(), "lib/db/seed.sql"),
      path.resolve(process.cwd(), "db/seed.sql"),
    );

  const schema = readFileSync(schemaPath, "utf8");
  const seed = seedPath ? readFileSync(seedPath, "utf8").trim() : "";

  await db.tx(async ({ query }) => {
    await query(schema);
    if (seed) await query(seed);
  });
}

// lib/db/db-bootstrap.ts
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolConfig } from "pg";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 여러 위치 시도
function firstExistingPath(...paths: string[]): string {
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    `schema.sql not found. tried:\n - ${paths.join("\n - ")}`
  );
}

function sslOption(u: string): PoolConfig["ssl"] {
  const needSSL =
    /neon\.tech|supabase\.co|amazonaws\.com|herokuapp\.com/i.test(u) ||
    /sslmode=require/i.test(u);
  return needSSL ? { rejectUnauthorized: false } : undefined;
}

async function main(dbUrlRaw: unknown): Promise<void> {
  const dbUrl = String(dbUrlRaw || "").trim();

  if (!dbUrl) {
    throw new Error("DATABASE_URL is not set (empty)");
  }
  if (!/^postgres(ql)?:\/\//i.test(dbUrl)) {
    throw new Error(
      `DATABASE_URL must start with "postgres://" or "postgresql://"\n` +
      `Got: ${dbUrl.split("@").at(-1)}`
    );
  }

  const schemaPath = firstExistingPath(
    path.resolve(__dirname, "schema.sql"),
    path.resolve(process.cwd(), "lib/db/schema.sql"),
    path.resolve(process.cwd(), "db/schema.sql"),
  );
  const seedPath = firstExistingPath(
    path.resolve(__dirname, "seed.sql"),
    path.resolve(process.cwd(), "lib/db/seed.sql"),
    path.resolve(process.cwd(), "db/seed.sql"),
  );

  const schema = readFileSync(schemaPath, "utf8");
  const seed = existsSync(seedPath) ? readFileSync(seedPath, "utf8").trim() : "";

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: sslOption(dbUrl),
  });

  try {
    await pool.query("BEGIN");
    await pool.query(schema);
    if (seed) await pool.query(seed);
    await pool.query("COMMIT");
    console.log("DB bootstrap complete.");
  } catch (err) {
    await pool.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await pool.end().catch(() => {});
  }
}

await main(process.env.DATABASE_URL).catch((e) => {
  console.error(e);
  process.exit(1);
});

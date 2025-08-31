// lib/bibtex/config.ts
import type { Env } from "../db/bootstrap.js";


type DBLike = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };

let __cache: { url: string | null; style: string | null; ts: number } | null = null;
const CACHE_MS = 60_000;

export async function resolveBibtexConfig(env: Env, db: DBLike): Promise<{ url: string | null; style: string | null }> {
  const byEnv = (env.BIBTEX_FILE || (process.env as any).BIBTEX_FILE || "").trim();
  const styleEnv = (env.BIBTEX_STYLE || (process.env as any).BIBTEX_STYLE || "").trim() || null;

  if (byEnv) return { url: byEnv, style: styleEnv };

  // cache
  const now = Date.now();
  if (__cache && now - __cache.ts < CACHE_MS) {
    return { url: __cache.url, style: __cache.style };
  }

  let url: string | null = null;
  try {
    const { rows } = await db.query(`select v from app_settings where k='bibtex_url' limit 1`);
    url = rows?.[0]?.v ?? null;
  } catch { /* ignore */ }

  __cache = { url, style: styleEnv, ts: now };
  return { url, style: styleEnv };
}

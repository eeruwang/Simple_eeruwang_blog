// lib/env.ts
type Bool = boolean;

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length ? v : undefined;
}

function bool(name: string, dflt = false): Bool {
  const v = process.env[name];
  if (v == null) return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}

export type AppEnv = {
  SITE_URL: string;
  SITE_NAME: string;
  NOTES_TAGS?: string;
  ALLOW_DEBUG: boolean;
  TZ?: string;

  EDITOR_PASSWORD: string;
  EDITOR_ASSET_VER?: string;

  BIBTEX_FILE?: string;
  BIBTEX_STYLE?: string;

  DATABASE_URL: string; // 또는 NEON_DATABASE_URL 우선

  // NocoDB (설정 시 PostgreSQL 대신 사용)
  NOCODB_HOST?: string;
  NOCODB_API_KEY?: string;
  NOCODB_TABLE_ID?: string;
};

export const env: AppEnv = (() => {
  const SITE_URL = req("SITE_URL");
  const SITE_NAME = req("SITE_NAME");

  // DB 우선순위: NEON_DATABASE_URL -> DATABASE_URL
  const NEON = opt("NEON_DATABASE_URL");
  const DB = opt("DATABASE_URL");
  const hasNocoDB = !!(opt("NOCODB_HOST") && opt("NOCODB_API_KEY") && opt("NOCODB_TABLE_ID"));
  const DATABASE_URL = hasNocoDB ? "" : (process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "");

  return {
    SITE_URL,
    SITE_NAME,
    NOTES_TAGS: opt("NOTES_TAGS"),
    ALLOW_DEBUG: bool("ALLOW_DEBUG", false),
    TZ: opt("TZ"),

    EDITOR_PASSWORD: req("EDITOR_PASSWORD"),
    EDITOR_ASSET_VER: opt("EDITOR_ASSET_VER"),

    BIBTEX_FILE: opt("BIBTEX_FILE"),
    BIBTEX_STYLE: opt("BIBTEX_STYLE"),

    DATABASE_URL,

    NOCODB_HOST: opt("NOCODB_HOST"),
    NOCODB_API_KEY: opt("NOCODB_API_KEY"),
    NOCODB_TABLE_ID: opt("NOCODB_TABLE_ID"),
  };
})();

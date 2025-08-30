// lib/api/editor.ts

import { Pool } from "pg";
import { put, del } from "@vercel/blob";
import { Buffer } from "node:buffer";
import { normalizeSlug } from "../../lib/slug.js";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export type Env = {
  DATABASE_URL?: string;
  NEON_DATABASE_URL?: string;
  EDITOR_PASSWORD?: string;
  SITE_URL?: string;
  BLOB_READ_WRITE_TOKEN?: string;
  [k: string]: unknown;
};

type QueryResult<T = any> = { rows: T[] };

type DB = {
  query: (sql: string, params?: any[]) => Promise<QueryResult>;
  tx: <T>(fn: (q: { query: DB["query"] }) => Promise<T>) => Promise<T>;
};

// ─────────────────────────────────────────────────────────────
// Module-level singletons
// ─────────────────────────────────────────────────────────────
let pool: Pool | null = null;
let __autoBootstrappedOnce = false;
let __schemaEnsured = false;

// ─────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────
function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function isMissingTableError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e ?? "");
  return /42P01/.test(msg) || /relation ["']?posts["']? does not exist/i.test(msg);
}

function requireEditor(request: Request, env: Env): boolean {
  const want = (env.EDITOR_PASSWORD || process.env.EDITOR_PASSWORD || "").trim();
  if (!want) return false;
  const got = request.headers.get("x-editor-token")?.trim() || "";
  return got === want;
}

// ✅ 서버 사이드 슬러그 표준화: 한글 보존 + 허용셋 필터 + 공백→하이픈
function slugifyForApi(s: string): string {
  return normalizeSlug(s) || "post";
}

function normTags(t: unknown): string[] {
  if (Array.isArray(t)) return t.map(x => String(x).trim()).filter(Boolean);
  if (typeof t === "string") {
    return t
      .split(/[,\n]/g)
      .map(x => x.trim())
      .filter(Boolean);
  }
  return [];
}

async function ensureUniqueSlug(q: { query: DB["query"] }, desired: string): Promise<string> {
  // 입력값을 반드시 normalize 해 유니크 판단 기준을 일치시킵니다.
  let base = slugifyForApi(desired || "post");
  let s = base;
  let n = 0;
  while (n < 500) {
    const { rows } = await q.query(`select 1 from posts where slug=$1 limit 1`, [s]);
    if (!rows || rows.length === 0) return s;
    n += 1;
    s = `${base}-${n}`;
  }
  throw new Error("cannot allocate unique slug");
}

async function ensureUniqueSlugNoTx(db: DB, desired: string): Promise<string> {
  return ensureUniqueSlug({ query: db.query }, desired);
}

// 아주 보수적인 서버사이드 Markdown → HTML(외부 라이브러리 없이)
function mdToSafeHtml(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let t = esc(md);
  t = t.replace(/```([\s\S]*?)```/g, (_m, code) => `<pre><code>${code}</code></pre>`);
  t = t.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>`);
  t = t.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  t = t.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  t = t.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  t = t.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  t = t.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  t = t.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");
  t = t
    .split(/\n{2,}/)
    .map(block => (/^\s*<(h\d|pre)>/.test(block) ? block : `<p>${block.replace(/\n/g, "<br>")}</p>`))
    .join("\n");
  return t;
}

// ─────────────────────────────────────────────────────────────
// DB
// ─────────────────────────────────────────────────────────────
export function createDb(env: Env): DB {
  if (!pool) {
    // ✅ DB URL 해석 통일(DATABASE_URL 우선, 없으면 NEON_DATABASE_URL)
    const url =
      env.DATABASE_URL ||
      process.env.DATABASE_URL ||
      env.NEON_DATABASE_URL ||
      (process.env as any).NEON_DATABASE_URL ||
      "";
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString: url, max: 5 });
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

// ─────────────────────────────────────────────────────────────
// BIBTEX Helper 
// ─────────────────────────────────────────────────────────────

async function setSetting(db: DB, key: string, val: string) {
  await db.query(
    `insert into app_settings(k,v) values($1,$2)
     on conflict (k) do update set v=excluded.v, updated_at=now()`,
    [key, val]
  );
}
async function getSetting(db: DB, key: string): Promise<string | null> {
  const { rows } = await db.query(`select v from app_settings where k=$1 limit 1`, [key]);
  return rows?.[0]?.v ?? null;
}


// ─────────────────────────────────────────────────────────────
// API Entry
// ─────────────────────────────────────────────────────────────
export async function handleEditorApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const db = createDb(env);

  // 인스턴스 최초 1회: 테이블/트리거 보증(이미 있으면 NOOP)
  if (!__schemaEnsured) {
    __schemaEnsured = true;
    try { await bootstrapDb(db); } catch {}
  }

  // ── 헬스체크
  if (pathname === "/api/diag-db" && request.method === "GET") {
    try {
      const { rows } = await db.query("select now()");
      return json({ ok: true, now: rows?.[0]?.now ?? null });
    } catch (e: any) {
      return json({ ok: false, error: e?.message || String(e) }, 500);
    }
  }

  // ── 부트스트랩(보호됨)
  if (pathname === "/api/admin/bootstrap" && (request.method === "GET" || request.method === "POST")) {
    if (!requireEditor(request, env)) return json({ error: "unauthorized" }, 401);
    try { await bootstrapDb(db); return json({ ok: true }); }
    catch (e: any) { return json({ ok: false, error: e?.message || String(e) }, 500); }
  }

  // ── 관리용 설정 API (GET 전체/단건, PUT 저장) ─────────────────────────────
  if (pathname === "/api/admin/settings") {
    if (!requireEditor(request, env)) return json({ error: "unauthorized" }, 401);

    if (request.method === "GET") {
      const key = url.searchParams.get("key");
      if (key) {
        const v = await getSetting(db, key);
        return json({ ok: true, key, value: v });
      } else {
        const { rows } = await db.query(
          `select k as key, v as value, updated_at from app_settings order by k asc`
        );
        return json({ ok: true, list: rows });
      }
    }

    if (request.method === "PUT") {
      const body = await request.json().catch(() => ({}));
      const key = String(body?.key || "").trim();
      const val = String(body?.value ?? "");
      if (!key) return json({ error: "key required" }, 400);
      await setSetting(db, key, val);
      return json({ ok: true });
    }
  }


  // ── 미리보기: POST /api/posts/preview
  if (pathname === "/api/posts/preview" && request.method === "POST") {
    if (!requireEditor(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const md = String(body?.md ?? body?.text ?? "");

    // ⬇ 추가: BibTeX 처리(환경변수 → DB 설정)
    try {
      const { resolveBibtexConfig } = await import("../bibtex/config.js");
      const { processBib } = await import("../../lib/bibtex/bibtex.js");
      const { url: bibUrl, style } = await resolveBibtexConfig(env, db);

      if (bibUrl) {
        const { content, bibliographyHtml } = await processBib(md, bibUrl, {
          style: style || "harvard",
          usageHelp: true,
          ibid: true,
        });
        const html = mdToSafeHtml(content) + bibliographyHtml;
        return json({ ok: true, html });
      }
    } catch { /* 없으면 무시하고 기본 처리 */ }

    const html = mdToSafeHtml(md);
    return json({ ok: true, html });
  }


  // ── 업로드: POST /api/upload
  if (pathname === "/api/upload" && request.method === "POST") {
    if (!requireEditor(request, env)) return json({ error: "unauthorized" }, 401);

    const token =
      env.BLOB_READ_WRITE_TOKEN ||
      (process.env as any).BLOB_READ_WRITE_TOKEN ||
      "";

    try {
      const urlObj = new URL(request.url);
      const overwrite = urlObj.searchParams.get("overwrite") === "1"; // ← 덮어쓰기 플래그

      let filename = `upload-${Date.now()}`;
      let contentType = "application/octet-stream";
      let bodyForPut: Blob | ArrayBuffer;

      const ctypeHeader = request.headers.get("content-type") || "";
      if (ctypeHeader.startsWith("multipart/form-data")) {
        const form = await request.formData();
        const f = form.get("file");
        if (!f || typeof f === "string") return json({ error: "file field missing" }, 400);
        const file = f as File;
        // name 필드가 있으면 그것(= reference.bib)을 우선 사용
        filename = (form.get("name") as string) || file.name || filename;
        contentType = file.type || "text/plain";
        bodyForPut = file; // Blob
      } else {
        const body = await request.json().catch(() => ({}));
        const raw = String(body?.data || "");
        filename = String(body?.name || filename);
        contentType = String(body?.contentType || contentType);
        const m = raw.match(/^data:[^;]+;base64,(.+)$/);
        const b64 = m ? m[1] : raw;
        const buf = Buffer.from(b64, "base64");
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        bodyForPut = ab; // ArrayBuffer
        if (!contentType) contentType = "text/plain";
      }

      // ✅ 덮어쓰기: 기존 경로 삭제(실패해도 무시)
      if (overwrite && filename) {
        try { await del(filename, { token: token || undefined }); } catch {}
      }

      // ✅ 랜덤 suffix 제거 → 항상 동일 경로(reference.bib)에 업로드
      const res = await put(filename, bodyForPut, {
        access: "public",
        contentType,
        token: token || undefined,
        addRandomSuffix: false,            // ★ 중요: 파일명 고정
      });

      /* === PATCH: reference.bib 이면 설정 저장 ================================== */
      if (filename?.toLowerCase() === "reference.bib") {
        try {
          await setSetting(db, "bibtex_url", res.url);
          await setSetting(db, "bibtex_path", res.pathname);
          await setSetting(db, "bibtex_content_type", contentType || "text/plain");
        } catch (e) {
          console.warn("[upload] failed to persist bibtex setting:", e);
          // 저장 실패해도 업로드 성공은 그대로 반환
        }
      }
      /* ======================================================================== */


      return json({ ok: true, url: res.url, path: res.pathname, contentType });
    } catch (e: any) {
      return json({ ok: false, error: e?.message || String(e) }, 500);
    }
  }

  


  // ── Posts root (/api/posts)
  const postsRoot = pathname === "/api/posts";
  const mById = pathname.match(/^\/api\/posts\/(\d+)$/); // numeric id

  // 목록 또는 단건 (쿼리 방식 지원: ?id=, ?slug=)
  if (request.method === "GET" && (postsRoot || mById)) {
    // 단건: /api/posts/:id
    if (mById) {
      const id = Number(mById[1]);
      try {
        const { rows } = await db.query(
          `select id, title, body_md, slug, tags, excerpt,
                  is_page, published, published_at, cover_url,
                  created_at, updated_at
           from posts where id=$1 limit 1`,
          [id]
        );
        if (!rows.length) return json({ error: "not found" }, 404);
        return json({ item: rows[0] });
      } catch (e: any) {
        if (isMissingTableError(e)) { await bootstrapDb(db); return json({ error: "not found" }, 404); }
        return json({ error: e?.message || String(e) }, 500);
      }
    }

    // 쿼리 단건 (?id= or ?slug=) 또는 목록
    const idQ = url.searchParams.get("id");
    const slugQ = url.searchParams.get("slug");

    // 단건 by id
    if (idQ) {
      const id = Number(idQ);
      const { rows } = await db.query(
        `select id, title, body_md, slug, tags, excerpt,
                is_page, published, published_at, cover_url,
                created_at, updated_at
         from posts where id=$1 limit 1`,
        [id]
      );
      if (!rows.length) return json({ error: "not found" }, 404);
      return json({ item: rows[0] });
    }

    // ✅ 단건 by slug (공백/대소문자 차이 완화, 한글은 그대로 일치)
    if (slugQ) {
      const slugNorm = slugifyForApi(String(slugQ)); // URL에서 온 값도 표준화
      const { rows } = await db.query(
        `select id, title, body_md, slug, tags, excerpt,
                is_page, published, published_at, cover_url,
                created_at, updated_at
         from posts
         where lower(slug) = lower(trim($1))
         limit 1`,
        [slugNorm]
      );
      if (!rows.length) return json({ error: "not found" }, 404);
      return json({ item: rows[0] });
    }

    // 목록
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1000);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

    try {
      const { rows } = await db.query(
        `select id, title, body_md, slug, tags, excerpt,
                is_page, published, published_at, cover_url,
                created_at, updated_at
         from posts
         order by published desc, published_at desc nulls last, updated_at desc nulls last, id desc
         limit $1 offset $2`,
        [limit, offset]
      );

      // 최초 1회: 목록 비면 자동 부트스트랩(조용히)
      if (!__autoBootstrappedOnce && rows.length === 0) {
        __autoBootstrappedOnce = true;
        try { await bootstrapDb(db); } catch {}
      }

      return json({ list: rows });
    } catch (e: any) {
      if (isMissingTableError(e)) {
        await bootstrapDb(db);
        const { rows } = await db.query(
          `select id, title, body_md, slug, tags, excerpt,
                  is_page, published, published_at, cover_url,
                  created_at, updated_at
           from posts
           order by published desc, published_at desc nulls last, updated_at desc nulls last, id desc
           limit $1 offset $2`,
          [limit, offset]
        );
        return json({ list: rows });
      }
      return json({ error: e?.message || String(e) }, 500);
    }
  }

  // 생성: POST /api/posts (단건/배열 허용)
  if (request.method === "POST" && postsRoot) {
    if (!requireEditor(request, env)) return json({ error: "unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const inputs = Array.isArray(body) ? body : [body];

    const createWithTx = async (): Promise<any[]> => {
      return db.tx(async ({ query }) => {
        const out: any[] = [];
        for (const b of inputs) {
          const tagsArr = Array.isArray(b.tags)
            ? b.tags.map((x: any) => String(x).trim()).filter(Boolean)
            : normTags(b.tags);

          // ✅ 타이틀/입력 슬러그 모두 표준화 후 유니크 확보(한글 보존)
          const baseSlug = slugifyForApi(b.title || "");
          const desired = slugifyForApi(String(b.slug || baseSlug));
          const uniqueSlug = await ensureUniqueSlug({ query }, desired);

          const published = !!b.published;
          const publishedAtExplicit =
            b.published_at && String(b.published_at).trim() ? String(b.published_at) : null;
          const publishedAtFinal = publishedAtExplicit ?? (published ? new Date().toISOString() : null);

          const { rows: ins } = await query(
            `insert into posts
            (title, body_md, slug, tags, excerpt, is_page, published, published_at, cover_url)
            values ($1,$2,$3,$4::text[],$5,$6::boolean,$7::boolean,$8::timestamptz,$9)
            returning id, title, slug, published, published_at`,
            [
              b.title || "(untitled)",
              b.body_md ?? "",
              uniqueSlug,
              tagsArr,                  // ::text[] 로 캐스팅
              b.excerpt ?? "",
              !!b.is_page,              // ::boolean
              published,                // ::boolean
              publishedAtFinal,         // ::timestamptz (null 가능)
              b.cover_url ?? null,
            ]
          );
          out.push(ins[0]);
        }
        return out;
      });
    };

    try {
      const created = await createWithTx();
      return json({ ok: true, created });
    } catch (e: any) {
      if (isMissingTableError(e)) {
        await bootstrapDb(db);
        const created = await createWithTx();
        return json({ ok: true, created });
      }
      return json({ error: e?.message || String(e) }, 500);
    }
  }

  // 수정: PUT/PATCH /api/posts/:id
  if ((request.method === "PUT" || request.method === "PATCH") && pathname.startsWith("/api/posts/")) {
    if (!requireEditor(request, env)) return json({ error: "unauthorized" }, 401);

    const m = pathname.match(/^\/api\/posts\/(\d+)$/);
    if (!m) return json({ error: "bad request" }, 400);
    const id = Number(m[1]);

    const body = await request.json().catch(() => ({}));

    try {
      const updated = await db.tx(async ({ query }) => {
        // 현재 행
        const { rows: curRows } = await query(
          `select id, title, slug, body_md, tags, excerpt, is_page, published, published_at, cover_url
            from posts where id=$1 limit 1`,
          [id]
        );
        if (!curRows.length) throw new Error("not found");
        const cur = curRows[0];

        // ✅ slug 유니크 (입력값은 normalize 후 비교/적용)
        let nextSlug = cur.slug as string;
        if (typeof body.slug === "string" && body.slug.trim()) {
          const normalized = slugifyForApi(String(body.slug));
          if (normalized !== nextSlug) {
            nextSlug = await ensureUniqueSlug({ query }, normalized);
          }
        }

        // tags 정규화
        const tagsArr =
          typeof body.tags === "undefined"
            ? undefined
            : (Array.isArray(body.tags)
                ? body.tags.map((x: any) => String(x).trim()).filter(Boolean)
                : normTags(String(body.tags)));

        // published_at 자동 규칙
        let publishedAtValue: string | null | undefined = undefined;
        const hasPublished = typeof body.published === "boolean";
        const nextPub = hasPublished ? !!body.published : !!cur.published;

        if (typeof body.published_at === "undefined") {
          // 입력이 없는데 발행 상태로 바뀌고 기존에 없으면 now()
          if (nextPub && !cur.published_at) publishedAtValue = new Date().toISOString();
        } else {
          // 명시(null 포함)
          if (body.published_at) {
            publishedAtValue = String(body.published_at);
          } else {
            // null 보냈는데 발행이면 now로 보정, 아니면 null 유지
            publishedAtValue = nextPub ? new Date().toISOString() : null;
          }
        }

        // 동적 UPDATE 빌드 (캐스팅 포함)
        const fields: string[] = [];
        const vals: any[] = [];
        const add = (col: string, value: any, cast = "") => {
          const i = vals.length + 1;
          fields.push(`${col}=$${i}${cast}`);
          vals.push(value);
        };

        if (typeof body.title === "string")        add("title", body.title || "(untitled)");
        if (typeof body.body_md === "string")      add("body_md", body.body_md ?? "");
        if (typeof body.excerpt === "string")      add("excerpt", body.excerpt ?? "");
        if (typeof body.cover_url === "string")    add("cover_url", body.cover_url || null);
        if (typeof body.is_page === "boolean")     add("is_page", !!body.is_page, "::boolean");
        if (typeof body.published === "boolean")   add("published", !!body.published, "::boolean");
        if (nextSlug !== cur.slug)                 add("slug", nextSlug);
        if (typeof tagsArr !== "undefined")        add("tags", tagsArr, "::text[]");
        if (typeof publishedAtValue !== "undefined") add("published_at", publishedAtValue, "::timestamptz");

        // 항시 갱신
        fields.push(`updated_at=now()`);

        if (!vals.length) {
          // 변경 없음 → 현재값 반환
          const { rows } = await query(
            `select id, title, slug, body_md, tags, excerpt, is_page, published, published_at, cover_url, created_at, updated_at
              from posts where id=$1`,
            [id]
          );
          return rows[0];
        }

        const { rows: upd } = await query(
          `update posts set ${fields.join(", ")} where id=$${vals.length + 1}
            returning id, title, slug, body_md, tags, excerpt, is_page, published, published_at, cover_url, created_at, updated_at`,
          [...vals, id]
        );
        return upd[0];
      });

      return json({ ok: true, updated });
    } catch (e: any) {
      if (isMissingTableError(e)) { await bootstrapDb(db); return json({ error: "not found" }, 404); }
      const msg = e?.message || String(e);
      const code = /not found/i.test(msg) ? 404 : 500;
      return json({ error: msg }, code);
    }
  }

  // 삭제: DELETE /api/posts/:id
  if (request.method === "DELETE" && pathname.startsWith("/api/posts/")) {
    if (!requireEditor(request, env)) return json({ error: "unauthorized" }, 401);
    const m = pathname.match(/^\/api\/posts\/(\d+)$/);
    if (!m) return json({ error: "bad request" }, 400);
    const id = Number(m[1]);
    try {
      const { rows } = await db.query(`delete from posts where id=$1 returning id`, [id]);
      if (!rows.length) return json({ error: "not found" }, 404);
      return json({ ok: true, deleted: rows[0].id });
    } catch (e: any) {
      if (isMissingTableError(e)) { await bootstrapDb(db); return json({ error: "not found" }, 404); }
      return json({ error: e?.message || String(e) }, 500);
    }
  }

  return json({ error: "Not Found" }, 404);
}

// lib/api/editor.ts
// Vercel + Neon(Postgres) + @vercel/blob 전체 기능 안정판
// - 목록/생성/읽기/수정/삭제
// - 서버사이드 미리보기(안전 HTML: 초간단 변환기)
// - 업로드(multipart/form-data 또는 JSON base64)
// - 스키마 자동 부트스트랩(초기 1회 + 에러시 재시도)
// - DB 헬스체크

import { Pool } from "pg";
import { put } from "@vercel/blob";
import { Buffer } from "node:buffer";


// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export type Env = {
  DATABASE_URL?: string;
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

function slugifyForApi(s: string): string {
  const base = (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "post";
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
  let base = (desired || "post").trim();
  if (!base) base = "post";
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
// - HTML 이스케이프 → 아주 기본 마크다운만 처리(#, **, *, 링크, 코드블록, 줄바꿈)
function mdToSafeHtml(md: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;")
     .replace(/</g, "&lt;")
     .replace(/>/g, "&gt;");

  let t = esc(md);

  // fenced code block ``` ```
  t = t.replace(/```([\s\S]*?)```/g, (_m, code) => `<pre><code>${code}</code></pre>`);

  // inline code `code`
  t = t.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);

  // bold **text**
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // italic *text*
  t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // links [text](url)
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, `<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>`);

  // headings # H1 .. ###### H6
  t = t.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  t = t.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  t = t.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  t = t.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  t = t.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  t = t.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // paragraphs: 두 줄 이상 공백 → 단락
  t = t
    .split(/\n{2,}/)
    .map(block => {
      if (/^\s*<h\d/.test(block) || /^\s*<pre>/.test(block)) return block;
      return `<p>${block.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  return t;
}

// ─────────────────────────────────────────────────────────────
// DB
// ─────────────────────────────────────────────────────────────
export function createDb(env: Env): DB {
  if (!pool) {
    const url = env.DATABASE_URL || process.env.DATABASE_URL || "";
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
  on posts (published_at desc nulls last, updated_at desc nulls last, id desc);
  `;
  await db.tx(async ({ query }) => { await query(ddl); });
}

// ─────────────────────────────────────────────────────────────
// API Entry
// ─────────────────────────────────────────────────────────────
export async function handleEditorApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const db = createDb(env);

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

  // ── 미리보기: POST /api/posts/preview
  if (pathname === "/api/posts/preview" && request.method === "POST") {
    if (!requireEditor(request, env)) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
    const md = String(body?.md ?? body?.text ?? "");
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
      let filename = `upload-${Date.now()}`;
      let contentType = "application/octet-stream";

      // put()에 넘길 최종 바디: Blob 또는 ArrayBuffer
      let bodyForPut: Blob | ArrayBuffer;

      const ctypeHeader = request.headers.get("content-type") || "";
      if (ctypeHeader.startsWith("multipart/form-data")) {
        // multipart → File(=Blob)을 그대로 사용
        const form = await request.formData();
        const f = form.get("file");
        if (!f || typeof f === "string") return json({ error: "file field missing" }, 400);

        const file = f as File;
        filename = (form.get("name") as string) || file.name || filename;
        contentType = file.type || contentType;

        bodyForPut = file; // Blob 그대로 전달
      } else {
        // JSON → { name, contentType, data(base64 또는 dataURL) }
        const body = await request.json().catch(() => ({}));
        const raw = String(body?.data || "");
        filename = String(body?.name || filename);
        contentType = String(body?.contentType || contentType);

        // dataURL 지원
        const m = raw.match(/^data:[^;]+;base64,(.+)$/);
        const b64 = m ? m[1] : raw;

        // Buffer → ArrayBuffer로 변환
        const buf = Buffer.from(b64, "base64");
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

        bodyForPut = ab; // ArrayBuffer로 전달
      }

      const res = await put(filename, bodyForPut, {
        access: "public",
        contentType,
        token: token || undefined,
      });

      return json({ ok: true, url: res.url, path: res.pathname, contentType });
    } catch (e: any) {
      return json({ ok: false, error: e?.message || String(e) }, 500);
    }
  }


  // ── Posts root (/api/posts)
  const postsRoot = pathname === "/api/posts";
  const mById = pathname.match(/^\/api\/posts\/(\d+)$/); // numeric id

  // 목록: GET /api/posts
  if (request.method === "GET" && postsRoot) {
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1000);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

    try {
      const { rows } = await db.query(
        `select id, title, body_md, slug, tags, excerpt,
                is_page, published, published_at, cover_url,
                created_at, updated_at
         from posts
         order by published_at desc nulls last, updated_at desc nulls last, id desc
         limit $1 offset $2`,
        [limit, offset]
      );

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
           order by published_at desc nulls last, updated_at desc nulls last, id desc
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

          const baseSlug = slugifyForApi(b.title || "") || "post";
          const desired = String(b.slug || baseSlug);
          const uniqueSlug = await ensureUniqueSlug({ query }, desired);

          const published = !!b.published;
          const publishedAtExplicit =
            b.published_at && String(b.published_at).trim() ? String(b.published_at) : null;

          const { rows: ins } = await query(
            `insert into posts
             (title, body_md, slug, tags, excerpt, is_page, published, published_at, cover_url)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             returning id, title, slug, published, published_at`,
            [
              b.title || "(untitled)",
              b.body_md ?? "",
              uniqueSlug,
              tagsArr,
              b.excerpt ?? "",
              !!b.is_page,
              published,
              publishedAtExplicit,
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

  // 읽기: GET /api/posts/:id
  if (request.method === "GET" && mById) {
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
      if (isMissingTableError(e)) {
        await bootstrapDb(db);
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
      return json({ error: e?.message || String(e) }, 500);
    }
  }

  // 수정: PUT /api/posts/:id
  if (request.method === "PUT" && mById) {
    if (!requireEditor(request, env)) return json({ error: "unauthorized" }, 401);
    const id = Number(mById[1]);
    const body = await request.json().catch(() => ({}));

    try {
      const updated = await db.tx(async ({ query }) => {
        // 현재 값
        const { rows: curRows } = await query(
          `select id, slug from posts where id=$1 limit 1`,
          [id]
        );
        if (!curRows.length) throw new Error("not found");

        // slug 처리(변경 요청 있을 때만 유니크 확보)
        let nextSlug = curRows[0].slug as string;
        if (typeof body.slug === "string" && body.slug.trim() !== "" && body.slug !== nextSlug) {
          nextSlug = await ensureUniqueSlug({ query }, String(body.slug));
        }

        const tagsArr = Array.isArray(body.tags)
          ? body.tags.map((x: any) => String(x).trim()).filter(Boolean)
          : (typeof body.tags === "string" ? normTags(body.tags) : undefined);

        const fields: string[] = [];
        const vals: any[] = [];
        const push = (sqlFrag: string, v: any) => { fields.push(sqlFrag); vals.push(v); };

        if (typeof body.title === "string") push(`title=$${fields.length+1}`, body.title || "(untitled)");
        if (typeof body.body_md === "string") push(`body_md=$${fields.length+1}`, body.body_md ?? "");
        if (typeof body.excerpt === "string") push(`excerpt=$${fields.length+1}`, body.excerpt ?? "");
        if (typeof body.cover_url === "string") push(`cover_url=$${fields.length+1}`, body.cover_url || null);
        if (typeof body.is_page === "boolean") push(`is_page=$${fields.length+1}`, !!body.is_page);
        if (typeof body.published === "boolean") push(`published=$${fields.length+1}`, !!body.published);
        if (typeof body.published_at !== "undefined") {
          const v = body.published_at && String(body.published_at).trim() ? String(body.published_at) : null;
          push(`published_at=$${fields.length+1}`, v);
        }
        if (typeof body.slug === "string") push(`slug=$${fields.length+1}`, nextSlug);
        if (typeof tagsArr !== "undefined") push(`tags=$${fields.length+1}`, tagsArr);

        push(`updated_at=now()`, undefined); // 값 없는 fragment (나중에 제거)

        // undefined 값 제거(위 updated_at=now() 보정)
        const fields2: string[] = [];
        const vals2: any[] = [];
        fields.forEach((frag, i) => {
          if (typeof vals[i] === "undefined") {
            if (/updated_at=now\(\)/.test(frag)) fields2.push(frag);
          } else {
            fields2.push(frag);
            vals2.push(vals[i]);
          }
        });

        if (!fields2.length) {
          // 변경 없음 → 현재값 반환
          const { rows } = await query(
            `select id, title, slug, published, published_at from posts where id=$1`,
            [id]
          );
          return rows[0];
        }

        const { rows: upd } = await query(
          `update posts set ${fields2.join(", ")} where id=$${fields2.length+1}
           returning id, title, slug, published, published_at`,
          [...vals2, id]
        );
        return upd[0];
      });

      return json({ ok: true, updated });
    } catch (e: any) {
      if (isMissingTableError(e)) {
        await bootstrapDb(db);
        return json({ error: "not found" }, 404);
      }
      const msg = e?.message || String(e);
      const code = /not found/i.test(msg) ? 404 : 500;
      return json({ error: msg }, code);
    }
  }

  // 삭제: DELETE /api/posts/:id
  if (request.method === "DELETE" && mById) {
    if (!requireEditor(request, env)) return json({ error: "unauthorized" }, 401);
    const id = Number(mById[1]);
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

// Postgres (pg) + Neon(serverless) 동시 지원, TS 완전판

import { json, slugifyForApi } from "../util.js";
import { normTags } from "../render/tags.js";
import { mdToSafeHtml } from "../../lib/markdown.js";

/* ===== 타입 ===== */
type QueryResult<T = any> = Promise<{ rows: T[] }>;

type DB = {
  query<T = any>(text: string, params?: any[]): QueryResult<T>;
  tx?<R>(fn: (db: { query: DB["query"] }) => Promise<R>): Promise<R>;
  end?: () => Promise<void> | void;
};

export type Env = {
  DATABASE_URL?: string;                 // 통일된 키
  DB_CLIENT?: "neon" | "pg";             // 강제 지정 가능(없으면 URL로 추론)
  EDITOR_PASSWORD?: string;              // 편집 권한 키
};

function isNumericId(s: string) {
  return /^[0-9]+$/.test(s);
}

/* ===== 인증 가드 ===== */
function requireEditor(request: Request, env: Env) {
  const pass =
    env.EDITOR_PASSWORD ||
    (globalThis as any).process?.env?.EDITOR_PASSWORD ||
    "";
  const got =
    request.headers.get("x-editor-token") ||
    request.headers.get("x-editor-key") ||
    new URL(request.url).searchParams.get("token") ||
    "";
  return Boolean(pass && got && pass === got);
}

/* 매니지드 서비스 대부분은 SSL 필요 */
function shouldEnableSSL(url: string): boolean {
  return (
    /neon\.tech|supabase\.co|amazonaws\.com|herokuapp\.com/i.test(url) ||
    /sslmode=require/i.test(url)
  );
}

/* ===== DB 커넥터 (pg / neon 자동 선택) ===== */
export async function createDb(env: Env): Promise<DB> {
  const url =
    env.DATABASE_URL ||
    (typeof process !== "undefined"
      ? (process.env.DATABASE_URL as string)
      : "");

  if (!url) throw new Error("DATABASE_URL not set");

  const client: "neon" | "pg" =
    env.DB_CLIENT || (url.includes("neon.tech") ? "neon" : "pg");

  if (client === "neon") {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);

    // 공통 쿼리 헬퍼
    const q = async <T = any>(text: string, params?: any[]) => {
      const rows = await (sql as any).unsafe(text, params ?? []);
      return { rows: rows as T[] };
    };

    // begin 지원 여부 감지
    const hasBegin = typeof (sql as any).begin === "function";

    // 트랜잭션: 지원되면 사용, 아니면 동일 커넥션으로 그냥 실행 (fallback)
    const tx = async <R>(fn: (db: { query: DB["query"] }) => Promise<R>) => {
      if (hasBegin) {
        return (sql as any).begin(async (sql2: any) => {
          const q2 = async <T = any>(text: string, params?: any[]) => {
            const rows = await sql2.unsafe(text, params ?? []);
            return { rows: rows as T[] };
          };
          return fn({ query: q2 });
        });
      } else {
        // ⚠️ 실제 트랜잭션은 아님(낮은 경쟁 환경에선 충분)
        return fn({ query: q });
      }
    };

    return { query: q, tx };
  } else {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: url,
      ssl: shouldEnableSSL(url) ? { rejectUnauthorized: false } : undefined,
    });

    return {
      async query<T = any>(text: string, params?: any[]) {
        const res = await pool.query(text, params);
        return { rows: res.rows as T[] };
      },
      async tx<R>(fn: (db: { query: DB["query"] }) => Promise<R>) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const q = async <T = any>(text: string, params?: any[]) => {
            const res = await client.query(text, params);
            return { rows: res.rows as T[] };
          };
          const out = await fn({ query: q });
          await client.query("COMMIT");
          return out;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
      end: () => pool.end(),
    };
  }
}

/* ===== 슬러그 유니크 보장 ===== */
async function ensureUniqueSlug(
  db: Pick<DB, "query">,
  baseSlug: string,
  currentId?: number
) {
  let slug = baseSlug || "post";
  let n = 1;
  while (true) {
    const { rows } = await db.query<{ exists: boolean }>(
      `select exists(
         select 1 from posts
         where slug = $1 ${currentId ? "and id <> $2" : ""}
       ) as exists`,
      currentId ? [slug, currentId] : [slug]
    );
    if (!rows[0]?.exists) return slug;
    n += 1;
    slug = `${baseSlug}-${n}`;
  }
}

/* ===== 메인 핸들러 ===== */
export async function handleEditorApi(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 라우트 패턴
  const isPostsRoot = pathname === "/api/posts";
  const matchPost = pathname.match(/^\/api\/posts\/([^/]+)$/);
  const matchUpload = pathname.match(/^\/api\/posts\/([^/]+)\/files$/);
  const isPreview = pathname === "/api/posts/preview";

  // DB 초기화
  let db: DB;
  try {
    db = await createDb(env);
  } catch (e: any) {
    return json({ error: `DB init failed: ${e?.message || e}` }, 500);
  }

  try {
    /* 미리보기: POST /api/posts/preview  (MD → 안전한 HTML) */
    if (request.method === "POST" && isPreview) {
      if (!requireEditor(request, env))
        return json({ error: "unauthorized" }, 401);

      const { md } = await request.json().catch(() => ({ md: "" }));
      const src = typeof md === "string" ? md : "";
      const html = mdToSafeHtml(src);
      return json({ html });
    }

    /* 목록: GET /api/posts */
    if (request.method === "GET" && isPostsRoot) {
      const limit = Math.min(
        parseInt(url.searchParams.get("limit") || "100", 10) || 100,
        200
      );
      const offset =
        parseInt(url.searchParams.get("offset") || "0", 10) || 0;

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

    /* 생성: POST /api/posts (단건/배열 허용) */
    if (request.method === "POST" && isPostsRoot) {
      if (!requireEditor(request, env))
        return json({ error: "unauthorized" }, 401);

      const body = await request.json().catch(() => ({}));
      const inputs = Array.isArray(body) ? body : [body];

      if (!db.tx) return json({ error: "tx not available" }, 500);

      const created = await db.tx(async (tx) => {
        const out: any[] = [];
        for (const b of inputs) {
          const tagsArr = Array.isArray(b.tags)
            ? b.tags.map((x: any) => String(x).trim()).filter(Boolean)
            : normTags(b.tags);

          const baseSlug = slugifyForApi(b.title || "") || "post";
          const desired = String(b.slug || baseSlug);
          const uniqueSlug = await ensureUniqueSlug(tx, desired);

          const published = !!b.published;
          const publishedAtExplicit =
            b.published_at && String(b.published_at).trim()
              ? String(b.published_at)
              : null;

          const { rows: ins } = await tx.query(
            `insert into posts
             (title, body_md, slug, tags, excerpt, is_page, published, published_at, cover_url)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             returning id, title, slug, published, published_at`,
            [
              b.title || "(untitled)",
              b.body_md ?? "",
              uniqueSlug,
              tagsArr, // text[]
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

      return json({ ok: true, created });
    }

    /* 파일 업로드 보류: POST /api/posts/:id/files */
    if (request.method === "POST" && matchUpload) {
      return json(
        {
          error: "File upload not configured",
          hint: "Connect S3/R2/Supabase Storage and update this route.",
        },
        501
      );
    }

    /* 단건 조회: GET /api/posts/:idOrSlug */
    if (request.method === "GET" && matchPost) {
      const idRaw = decodeURIComponent(matchPost[1]);
      const byId = isNumericId(idRaw);

      const { rows } = await db.query(
        `select id, title, body_md, slug, tags, excerpt,
                is_page, published, published_at, cover_url,
                created_at, updated_at
         from posts
         where ${byId ? "id = $1::int" : "slug = $1"}
         limit 1`,
        [idRaw]
      );
      if (!rows[0]) return json({ error: "Not found" }, 404);
      return json(rows[0]);
    }

    /* 업데이트: PATCH /api/posts/:idOrSlug */
    if (request.method === "PATCH" && matchPost) {
      if (!requireEditor(request, env))
        return json({ error: "unauthorized" }, 401);

      const idRaw = decodeURIComponent(matchPost[1]);
      const byId = isNumericId(idRaw);
      const b = await request.json().catch(() => ({} as any));

      const { rows: curRows } = await db.query(
        `select id, title, body_md, slug, tags, excerpt,
                is_page, published, published_at, cover_url
         from posts
         where ${byId ? "id = $1::int" : "slug = $1"}
         limit 1`,
        [idRaw]
      );
      if (!curRows[0]) return json({ error: "Not found" }, 404);

      const cur = curRows[0] as any;
      const id: number = cur.id;

      // 태그 정리
      let tags: string[] | undefined;
      if (Object.prototype.hasOwnProperty.call(b, "tags")) {
        tags = Array.isArray(b.tags)
          ? b.tags.map((x: any) => String(x).trim()).filter(Boolean)
          : normTags(b.tags);
      }

      // slug 보정(유니크)
      let newSlug: string | undefined;
      if (
        Object.prototype.hasOwnProperty.call(b, "slug") ||
        Object.prototype.hasOwnProperty.call(b, "title")
      ) {
        const desired =
          (b.slug && String(b.slug)) ||
          slugifyForApi(b.title || cur.title || "") ||
          cur.slug ||
          "post";
        newSlug = await ensureUniqueSlug(db, desired, id);
      }

      // 동적 필드 구성
      const fields: Record<string, any> = {};
      if (Object.prototype.hasOwnProperty.call(b, "title"))       fields.title = b.title;
      if (Object.prototype.hasOwnProperty.call(b, "body_md"))     fields.body_md = b.body_md;
      if (newSlug !== undefined)                                   fields.slug = newSlug;
      if (Object.prototype.hasOwnProperty.call(b, "excerpt"))     fields.excerpt = b.excerpt;
      if (Object.prototype.hasOwnProperty.call(b, "is_page"))     fields.is_page = !!b.is_page;
      if (Object.prototype.hasOwnProperty.call(b, "published"))   fields.published = !!b.published;
      if (tags !== undefined)                                      fields.tags = tags;
      if (Object.prototype.hasOwnProperty.call(b, "cover_url"))   fields.cover_url = b.cover_url;

      if (Object.prototype.hasOwnProperty.call(b, "published_at")) {
        const v = b.published_at;
        fields.published_at = v == null || String(v).trim() === "" ? null : String(v);
      }

      if (Object.keys(fields).length === 0)
        return json({ ok: true, id, note: "Nothing to update" });

      const setKeys = Object.keys(fields);
      const setSql = setKeys.map((k, i) => `${k} = $${i + 2}`).join(", ");
      const params = [id, ...setKeys.map((k) => fields[k])];

      const { rows: updated } = await db.query(
        `update posts set ${setSql}
         where id = $1
         returning id, title, slug, published, published_at`,
        params
      );
      return json({ ok: true, updated: updated[0] });
    }

    /* 삭제: DELETE /api/posts/:idOrSlug */
    if (request.method === "DELETE" && matchPost) {
      if (!requireEditor(request, env))
        return json({ error: "unauthorized" }, 401);

      const idRaw = decodeURIComponent(matchPost[1]);
      const byId = isNumericId(idRaw);

      const { rows } = await db.query<{ id: number }>(
        `delete from posts
         where ${byId ? "id = $1::int" : "slug = $1"}
         returning id`,
        [idRaw]
      );
      if (!rows[0]) return json({ error: "Not found" }, 404);
      return json({ ok: true, id: rows[0].id });
    }

    return json({ error: "Not found", path: pathname }, 404);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 500);
  } finally {
    try {
      await db.end?.();
    } catch {}
  }
}

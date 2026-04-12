// lib/api/editor.ts

// DB 유틸을 전용 모듈에서 가져옵니다
import { createDb, bootstrapDb } from "../db/bootstrap.js";
import type { DB, Env } from "../db/bootstrap.js";

// // ⬇ 레거시 경로 호환(다른 파일이 lib/api/editor.js에서 import해도 동작하도록)
// export { createDb, bootstrapDb } from "../db/bootstrap.js";
// export type { DB, Env } from "../db/bootstrap.js";

// ✅ 여기서 바로 재수출 (다른 모듈이 editor.js에서 가져가도록)
export { createDb, bootstrapDb };
export type { DB, Env };


import { put, del } from "@vercel/blob";
import { Buffer } from "node:buffer";
import { normalizeSlug } from "../../lib/slug.js";
import * as noco from "../db/nocodb.js";

// NocoDB 모드 감지 (파일 상단에서 초기화 — 호이스팅 문제 방지)
const _useNocoDB = !!(
  process.env.NOCODB_HOST &&
  process.env.NOCODB_API_KEY &&
  process.env.NOCODB_TABLE_ID
);
if (_useNocoDB) console.log("[editor] NocoDB mode enabled");

// ─────────────────────────────────────────────────────────────
// Module-level singletons
// ─────────────────────────────────────────────────────────────
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
// 요청 바디를 안전하게 JSON으로 읽기
// - content-type이 애매하거나, Vercel 프록시에서 바디가 버퍼/텍스트로 들어와도 복구
async function readJsonSafe(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    try {
      const t = await req.text();
      return t ? JSON.parse(t) : {};
    } catch {
      return {};
    }
  }
}


function isMissingTableError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e ?? "");
  return /42P01/.test(msg) || /relation ["']?posts["']? does not exist/i.test(msg);
}

function requireEditor(request: Request, env: Env): boolean {
  const wantRaw = (env?.EDITOR_PASSWORD ?? (process.env as any).EDITOR_PASSWORD) ?? "";
  const want = String(wantRaw).trim();
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

// 서버사이드 Markdown → 안전한 HTML: 전역 렌더러(markdown-it + sanitize-html)로 위임.
async function mdToSafeHtml(md: string): Promise<string> {
  const { mdToSafeHtml: render } = await import("../markdown.js");
  return render(md);
}

// ─────────────────────────────────────────────────────────────
// Upload validation
// ─────────────────────────────────────────────────────────────
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// SVG는 XSS 벡터 가능성으로 제외. reference.bib 업로드는 text/plain로 들어옵니다.
const ALLOWED_UPLOAD_MIME = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "text/plain",
  "application/x-bibtex",
  "application/octet-stream",
]);

function sanitizeUploadFilename(name: string): string {
  const basename = String(name || "").replace(/\\/g, "/").split("/").pop() || "";
  const cleaned = basename
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^\w. -]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 120);
  return cleaned || `upload-${Date.now()}`;
}

function ensureAllowedMime(ct: string): boolean {
  const t = String(ct || "").toLowerCase().split(";")[0]!.trim();
  return ALLOWED_UPLOAD_MIME.has(t);
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
  // NocoDB 모드면 전용 핸들러로 위임
  if (_useNocoDB) return handleEditorApiNocoDB(request, env);

  const url = new URL(request.url);
  const pathname = url.pathname;
  const db = createDb(env);
  const isEditor = requireEditor(request, env);

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
    if (!isEditor) return json({ error: "unauthorized" }, 401);
    try { await bootstrapDb(db); return json({ ok: true }); }
    catch (e: any) { return json({ ok: false, error: e?.message || String(e) }, 500); }
  }

  // ── 관리용 설정 API (GET 전체/단건, PUT 저장)
  if (pathname === "/api/admin/settings") {
    if (!isEditor) return json({ error: "unauthorized" }, 401);

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
      const body = await readJsonSafe(request);
      const key = String(body?.key || "").trim();
      const val = String(body?.value ?? "");
      if (!key) return json({ error: "key required" }, 400);
      await setSetting(db, key, val);
      return json({ ok: true });
    }
  }

  // ── 미리보기: POST /api/posts/preview
  if (pathname === "/api/posts/preview" && request.method === "POST") {
    if (!isEditor) return json({ error: "unauthorized" }, 401);
    const body = await readJsonSafe(request);
    const md = String(body?.md ?? body?.text ?? "");

    // ⬇ BibTeX 처리(환경변수 → DB 설정)
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
        const html = (await mdToSafeHtml(content)) + bibliographyHtml;
        return json({ ok: true, html });
      }
    } catch { /* 설정 없으면 기본 처리 */ }

    const html = await mdToSafeHtml(md);
    return json({ ok: true, html });
  }

  // ── 업로드: POST /api/upload
  if (pathname === "/api/upload" && request.method === "POST") {
    if (!isEditor) return json({ error: "unauthorized" }, 401);

    const token =
      (env as any).BLOB_READ_WRITE_TOKEN ||
      (process.env as any).BLOB_READ_WRITE_TOKEN ||
      "";

    try {
      const urlObj = new URL(request.url);
      const overwrite = urlObj.searchParams.get("overwrite") === "1"; // 덮어쓰기 플래그

      let filename = `upload-${Date.now()}`;
      let contentType = "application/octet-stream";
      let bodyForPut: Blob | ArrayBuffer;
      let byteLen = 0;

      const ctypeHeader = request.headers.get("content-type") || "";
      if (ctypeHeader.startsWith("multipart/form-data")) {
        const form = await request.formData();
        const f = form.get("file");
        if (!f || typeof f === "string") return json({ error: "file field missing" }, 400);
        const file = f as File;
        // name 필드가 있으면 그것(= reference.bib)을 우선 사용
        filename = sanitizeUploadFilename((form.get("name") as string) || file.name || filename);
        contentType = file.type || "text/plain";
        byteLen = file.size || 0;
        bodyForPut = file; // Blob
      } else {
        const body = await readJsonSafe(request);
        const raw = String(body?.data || "");
        filename = sanitizeUploadFilename(String(body?.name || filename));
        contentType = String(body?.contentType || contentType);
        const m = raw.match(/^data:[^;]+;base64,(.+)$/);
        const b64 = m ? m[1] : raw;
        const buf = Buffer.from(b64, "base64");
        byteLen = buf.byteLength;
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        bodyForPut = ab; // ArrayBuffer
        if (!contentType) contentType = "text/plain";
      }

      if (byteLen > MAX_UPLOAD_BYTES) {
        return json({ error: "file too large", limit: MAX_UPLOAD_BYTES }, 413);
      }
      if (!ensureAllowedMime(contentType)) {
        return json({ error: "unsupported content-type", contentType }, 415);
      }

      // 덮어쓰기: 기존 경로 삭제(실패해도 무시)
      if (overwrite && filename) {
        try { await del(filename, { token: token || undefined }); } catch {}
      }

      // 랜덤 suffix 제거 → 항상 동일 경로(reference.bib)에 업로드
      const res = await put(filename, bodyForPut, {
        access: "public",
        contentType,
        token: token || undefined,
        addRandomSuffix: false,
      });

      // reference.bib 업로드면 설정 저장
      if (filename?.toLowerCase() === "reference.bib") {
        try {
          await setSetting(db, "bibtex_url", res.url);
          await setSetting(db, "bibtex_path", res.pathname);
          await setSetting(db, "bibtex_content_type", contentType || "text/plain");
        } catch (e) {
          console.warn("[upload] failed to persist bibtex setting:", e);
        }
      }

      return json({ ok: true, url: res.url, path: res.pathname, contentType });
    } catch (e: any) {
      return json({ ok: false, error: e?.message || String(e) }, 500);
    }
  }

  // ── Tags aggregation: GET /api/tags
  if (pathname === "/api/tags" && request.method === "GET") {
    try {
      const { rows } = await db.query(
        `select distinct unnest(tags) as tag from posts
         where published = true and (is_page = false or is_page is null)
         order by tag asc`
      );
      const tags = rows.map((r: any) => String(r.tag || "").trim()).filter(Boolean);
      return json({ ok: true, tags });
    } catch (e: any) {
      if (isMissingTableError(e)) return json({ ok: true, tags: [] });
      return json({ ok: false, error: e?.message || String(e), tags: [] }, 500);
    }
  }

  // ── Posts root (/api/posts)
  const postsRoot = pathname === "/api/posts";
  const mById = pathname.match(/^\/api\/posts\/(\d+)$/); // numeric id

  // ── GET: 목록/단건
  if (request.method === "GET" && (postsRoot || mById)) {
    try {
      // 단건: /api/posts/:id
      if (mById) {
        const id = Number(mById[1]);
        const { rows } = await db.query(
          `select id, title, body_md, slug, tags, excerpt,
                  is_page, published, published_at, cover_url,
                  created_at, updated_at
             from posts where id=$1 limit 1`,
          [id]
        );
        if (!rows.length) return json({ error: "not found" }, 404);
        const row = rows[0];

        // 공개 여부: 드래프트(페이지 포함)는 에디터만 볼 수 있음
        const isPublic = row.published === true;
        if (!isPublic && !isEditor) return json({ error: "not found" }, 404);

        // 단건은 body_md 포함(공개 또는 에디터)
        return json({ item: row });
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
        const row = rows[0];
        const isPublic = row.published === true;
        if (!isPublic && !isEditor) return json({ error: "not found" }, 404);
        return json({ item: row });
      }

      // 단건 by slug (한글 보존 표준화 후 대소문자 무시 비교)
      if (slugQ) {
        const slugNorm = slugifyForApi(String(slugQ));
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
        const row = rows[0];
        const isPublic = row.published === true;
        if (!isPublic && !isEditor) return json({ error: "not found" }, 404);
        return json({ item: row }); // 단건은 body_md 포함
      }

      // 목록
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1000);
      const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

      if (isEditor) {
        // 에디터 토큰이 있으면 전체 목록(본문 제외)
        const { rows } = await db.query(
          `select id, slug, title, excerpt, tags, is_page, published,
                  published_at, cover_url, created_at, updated_at
             from posts
            order by published desc, published_at desc nulls last, updated_at desc nulls last, id desc
            limit $1 offset $2`,
          [limit, offset]
        );
        if (!__autoBootstrappedOnce && rows.length === 0) {
          __autoBootstrappedOnce = true;
          try { await bootstrapDb(db); } catch {}
        }
        return json({ list: rows });
      } else {
        // 공개 목록: 공개 포스트만(페이지 제외), 본문 제외
        const { rows } = await db.query(
          `select id, slug, title, excerpt, tags, is_page, published,
                  published_at, cover_url, created_at, updated_at
             from posts
            where published = true and (is_page = false or is_page is null)
            order by coalesce(published_at, updated_at, created_at) desc
            limit $1 offset $2`,
          [limit, offset]
        );
        return json({ list: rows });
      }
    } catch (e: any) {
      if (isMissingTableError(e)) {
        await bootstrapDb(db);
        return json({ list: [] });
      }
      return json({ error: e?.message || String(e) }, 500);
    }
  }

  // ── 생성: POST /api/posts (단건/배열 허용)
  if (request.method === "POST" && postsRoot) {
    if (!isEditor) return json({ error: "unauthorized" }, 401);

    const body = await readJsonSafe(request);
    const inputs = Array.isArray(body) ? body : [body];

    const createWithTx = async (): Promise<any[]> => {
      return db.tx(async ({ query }: { query: DB["query"] }) => {
        const out: any[] = [];
        for (const b of inputs) {
          const tagsArr = Array.isArray(b.tags)
            ? b.tags.map((x: any) => String(x).trim()).filter(Boolean)
            : normTags(b.tags);

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
              (typeof b.body_md === "string" ? b.body_md
                : (typeof b.bodyMd === "string" ? b.bodyMd : "")),
              uniqueSlug,
              tagsArr,
              b.excerpt ?? "",
              !!b.is_page,
              published,
              publishedAtFinal,
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

  // ── 수정: PUT/PATCH /api/posts/:id
  if ((request.method === "PUT" || request.method === "PATCH") && pathname.startsWith("/api/posts/")) {
    if (!isEditor) return json({ error: "unauthorized" }, 401);

    const m = pathname.match(/^\/api\/posts\/(\d+)$/);
    if (!m) return json({ error: "bad request" }, 400);
    const id = Number(m[1]);

    const body = await readJsonSafe(request);

    try {
      const updated = await db.tx(async ({ query }: { query: DB["query"] }) => {
        // 현재 행
        const { rows: curRows } = await query(
          `select id, title, slug, body_md, tags, excerpt, is_page, published, published_at, cover_url
             from posts where id=$1 limit 1`,
          [id]
        );
        if (!curRows.length) throw new Error("not found");
        const cur = curRows[0];

        // slug 유니크 (입력값은 normalize 후 비교/적용)
        let nextSlug: string = cur.slug as string;
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
          if (nextPub && !cur.published_at) publishedAtValue = new Date().toISOString();
        } else {
          if (body.published_at) {
            publishedAtValue = String(body.published_at);
          } else {
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
        if (Object.prototype.hasOwnProperty.call(body, "body_md")) {
          add("body_md", (body as any).body_md ?? "");
        } else if (Object.prototype.hasOwnProperty.call(body, "bodyMd")) {
          add("body_md", (body as any).bodyMd ?? "");
        }
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

  // ── 삭제: DELETE /api/posts/:id
  if (request.method === "DELETE" && pathname.startsWith("/api/posts/")) {
    if (!isEditor) return json({ error: "unauthorized" }, 401);
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

// ─────────────────────────────────────────────────────────────
// NocoDB CRUD handler (NOCODB_HOST가 설정된 경우 사용)
// ─────────────────────────────────────────────────────────────

export async function handleEditorApiNocoDB(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const isEditor = requireEditor(request, env);

  // ── 헬스체크
  if (pathname === "/api/diag-db" && request.method === "GET") {
    try {
      const info = await noco.pingDb();
      return json({ ok: true, now: info.now, driver: "nocodb" });
    } catch (e: any) {
      return json({ ok: false, error: e?.message || String(e) }, 500);
    }
  }

  // ── 부트스트랩 (NocoDB는 스키마 자동 — NOOP)
  if (pathname === "/api/admin/bootstrap") {
    return json({ ok: true, message: "NocoDB mode: no bootstrap needed" });
  }

  // ── 설정 API
  if (pathname === "/api/admin/settings") {
    if (!isEditor) return json({ error: "unauthorized" }, 401);
    if (request.method === "GET") {
      const key = url.searchParams.get("key");
      if (key) {
        const v = await noco.nocoGetSetting(key);
        return json({ ok: true, key, value: v });
      }
      return json({ ok: true, list: [] });
    }
    if (request.method === "PUT") {
      const body = await readJsonSafe(request);
      await noco.nocoSetSetting(String(body?.key || ""), String(body?.value ?? ""));
      return json({ ok: true });
    }
  }

  // ── 미리보기
  if (pathname === "/api/posts/preview" && request.method === "POST") {
    if (!isEditor) return json({ error: "unauthorized" }, 401);
    const body = await readJsonSafe(request);
    const md = String(body?.md ?? body?.text ?? "");
    const { mdToSafeHtml } = await import("../markdown.js");
    return json({ ok: true, html: mdToSafeHtml(md) });
  }

  // ── 업로드: NocoDB Storage API로 파일 업로드
  if (pathname === "/api/upload" && request.method === "POST") {
    if (!isEditor) return json({ error: "unauthorized" }, 401);

    try {
      let filename = `upload-${Date.now()}`;
      let contentType = "application/octet-stream";
      let fileBlob: Blob;

      const ctypeHeader = request.headers.get("content-type") || "";
      let byteLen = 0;

      if (ctypeHeader.startsWith("multipart/form-data")) {
        const form = await request.formData();
        const f = form.get("file");
        if (!f || typeof f === "string") return json({ error: "file field missing" }, 400);
        const file = f as File;
        filename = sanitizeUploadFilename((form.get("name") as string) || file.name || filename);
        contentType = file.type || contentType;
        byteLen = file.size || 0;
        fileBlob = file;
      } else {
        // JSON body: { name, contentType, data: base64 }
        const body = await readJsonSafe(request);
        const raw = String(body?.data || "");
        filename = sanitizeUploadFilename(String(body?.name || filename));
        contentType = String(body?.contentType || contentType);
        const m = raw.match(/^data:[^;]+;base64,(.+)$/);
        const b64 = m ? m[1] : raw;
        const buf = Buffer.from(b64, "base64");
        byteLen = buf.byteLength;
        fileBlob = new Blob([buf], { type: contentType });
      }

      if (byteLen > MAX_UPLOAD_BYTES) {
        return json({ error: "file too large", limit: MAX_UPLOAD_BYTES }, 413);
      }
      if (!ensureAllowedMime(contentType)) {
        return json({ error: "unsupported content-type", contentType }, 415);
      }

      const result = await noco.nocoUpload(fileBlob, filename, contentType);

      // reference.bib면 BibTeX 설정 URL로 저장 (NocoDB 모드는 env 기반이라 경고만)
      if (filename?.toLowerCase() === "reference.bib") {
        console.log("[nocodb] reference.bib uploaded:", result.url);
        console.log("[nocodb] Set BIBTEX_FILE env var to:", result.url);
      }

      // 기존 클라이언트 코드와 호환되는 응답 형식
      return json({
        ok: true,
        url: result.url,
        path: result.path,
        contentType: result.mimetype,
        size: result.size,
      });
    } catch (e: any) {
      console.error("[nocodb] upload failed:", e?.message || e);
      return json({ ok: false, error: e?.message || String(e) }, 500);
    }
  }

  // ── Tags aggregation (NocoDB mode)
  if (pathname === "/api/tags" && request.method === "GET") {
    try {
      const all = await noco.nocoListAll(500, 0, true);
      const set = new Set<string>();
      for (const r of all) {
        if (Array.isArray(r.tags)) {
          for (const t of r.tags) {
            const s = String(t || "").trim();
            if (s) set.add(s);
          }
        }
      }
      const tags = Array.from(set).sort();
      return json({ ok: true, tags });
    } catch (e: any) {
      console.error("[nocodb] /api/tags failed:", e?.message || e);
      return json({ ok: false, error: e?.message || String(e), tags: [] }, 500);
    }
  }

  // ── Posts CRUD
  const postsRoot = pathname === "/api/posts";
  const mById = pathname.match(/^\/api\/posts\/(\d+)$/);

  // GET: 목록/단건
  if (request.method === "GET" && (postsRoot || mById)) {
    try {
      if (mById) {
        const row = await noco.nocoGetById(Number(mById[1]));
        if (!row) return json({ error: "not found" }, 404);
        if (!row.published && !isEditor) return json({ error: "not found" }, 404);
        return json({ item: row });
      }

      const idQ = url.searchParams.get("id");
      const slugQ = url.searchParams.get("slug");

      if (idQ) {
        const row = await noco.nocoGetById(Number(idQ));
        if (!row) return json({ error: "not found" }, 404);
        if (!row.published && !isEditor) return json({ error: "not found" }, 404);
        return json({ item: row });
      }

      if (slugQ) {
        const row = await noco.getBySlug(slugifyForApi(String(slugQ)));
        if (!row) return json({ error: "not found" }, 404);
        if (!row.published && !isEditor) return json({ error: "not found" }, 404);
        return json({ item: row });
      }

      // 목록
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1000);
      const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);
      const rows = await noco.nocoListAll(limit, offset, isEditor);
      return json({ list: rows });
    } catch (e: any) {
      console.error("[nocodb] list failed:", e?.message || e, e?.stack || "");
      return json({ error: e?.message || String(e), driver: "nocodb" }, 500);
    }
  }

  // POST: 생성
  if (request.method === "POST" && postsRoot) {
    if (!isEditor) return json({ error: "unauthorized" }, 401);
    try {
      const body = await readJsonSafe(request);
      const inputs = Array.isArray(body) ? body : [body];
      const created = [];

      for (const b of inputs) {
        const tags = normTags(b.tags);
        let slug = slugifyForApi(b.slug || b.title || "");
        // slug 중복 체크
        let n = 0;
        while (await noco.nocoIsSlugTaken(slug) && n < 100) {
          n++;
          slug = `${slugifyForApi(b.slug || b.title || "post")}-${n}`;
        }

        const row = await noco.nocoCreate({
          title: b.title || "(untitled)",
          body_md: b.body_md ?? b.bodyMd ?? "",
          slug,
          tags,
          excerpt: b.excerpt ?? "",
          is_page: !!b.is_page,
          published: !!b.published,
          published_at: b.published_at || (b.published ? new Date().toISOString() : null),
          cover_url: b.cover_url ?? null,
        });
        created.push(row);
      }

      return json({ ok: true, created });
    } catch (e: any) {
      return json({ error: e?.message || String(e) }, 500);
    }
  }

  // PUT/PATCH: 수정
  if ((request.method === "PUT" || request.method === "PATCH") && pathname.startsWith("/api/posts/")) {
    if (!isEditor) return json({ error: "unauthorized" }, 401);
    const m = pathname.match(/^\/api\/posts\/(\d+)$/);
    if (!m) return json({ error: "bad request" }, 400);
    const id = Number(m[1]);

    try {
      const body = await readJsonSafe(request);
      const updates: Record<string, any> = {};

      if (typeof body.title === "string") updates.title = body.title;
      if (body.body_md !== undefined) updates.body_md = body.body_md;
      if (body.bodyMd !== undefined) updates.body_md = body.bodyMd;
      if (typeof body.excerpt === "string") updates.excerpt = body.excerpt;
      if (typeof body.cover_url === "string") updates.cover_url = body.cover_url;
      if (typeof body.is_page === "boolean") updates.is_page = body.is_page;
      if (typeof body.published === "boolean") updates.published = body.published;
      if (body.published_at !== undefined) updates.published_at = body.published_at;
      if (body.tags !== undefined) updates.tags = normTags(body.tags);
      if (typeof body.slug === "string" && body.slug.trim()) {
        const newSlug = slugifyForApi(body.slug);
        if (!(await noco.nocoIsSlugTaken(newSlug, id))) {
          updates.slug = newSlug;
        }
      }

      const updated = await noco.nocoUpdate(id, updates);
      return json({ ok: true, updated });
    } catch (e: any) {
      return json({ error: e?.message || String(e) }, 500);
    }
  }

  // DELETE
  if (request.method === "DELETE" && pathname.startsWith("/api/posts/")) {
    if (!isEditor) return json({ error: "unauthorized" }, 401);
    const m = pathname.match(/^\/api\/posts\/(\d+)$/);
    if (!m) return json({ error: "bad request" }, 400);
    const id = Number(m[1]);
    try {
      await noco.nocoDelete(id);
      return json({ ok: true, deleted: id });
    } catch (e: any) {
      return json({ error: e?.message || String(e) }, 500);
    }
  }

  return json({ error: "Not Found" }, 404);
}

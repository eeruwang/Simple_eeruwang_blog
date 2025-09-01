// lib/api/editor.ts

// DB 유틸을 전용 모듈에서 가져옵니다
import { createDb, bootstrapDb } from "../db/bootstrap.js";
import type { DB, Env } from "../db/bootstrap.js";

// ⬇ 레거시 경로 호환(다른 파일이 lib/api/editor.js에서 import해도 동작하도록)
export { createDb, bootstrapDb } from "../db/bootstrap.js";
export type { DB, Env } from "../db/bootstrap.js";

import { put, del } from "@vercel/blob";
import { Buffer } from "node:buffer";
import { normalizeSlug } from "../../lib/slug.js";

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
    if (!isEditor) return json({ error: "unauthorized" }, 401);
    const body = await request.json().catch(() => ({}));
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
        const html = mdToSafeHtml(content) + bibliographyHtml;
        return json({ ok: true, html });
      }
    } catch { /* 설정 없으면 기본 처리 */ }

    const html = mdToSafeHtml(md);
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

        // 공개 여부 확인 (비공개면 토큰 필요)
        const isPublic = row.published === true || row.is_page === true;
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
        const isPublic = row.published === true || row.is_page === true;
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
        const isPublic = row.published === true || row.is_page === true;
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

    const body = await request.json().catch(() => ({}));
    const inputs = Array.isArray(body) ? body : [body];

    const createWithTx = async (): Promise<any[]> => {
      return db.tx(async ({ query }) => {
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

// lib/api/newpost.ts
// GET/POST /api/newpost  (에디터 비번으로 보호)
// - posts 스키마/인덱스/트리거 없으면 생성
// - 요청값으로 새 글 생성(기본값은 샘플 글)

import { createDb, type Env as DbEnv } from "./editor.js";

function j(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function authed(req: Request, env: DbEnv) {
  const pass =
    env.EDITOR_PASSWORD ||
    (globalThis as any).process?.env?.EDITOR_PASSWORD ||
    "";
  const u = new URL(req.url);
  const tok =
    req.headers.get("x-editor-token") ||
    req.headers.get("x-editor-key") ||
    u.searchParams.get("token") ||
    "";
  return Boolean(pass && tok && tok === pass);
}

async function ensureSchema(db: Awaited<ReturnType<typeof createDb>>) {
  await db.query(`
    create table if not exists posts (
      id           serial primary key,
      slug         text not null unique,
      title        text not null,
      body_md      text not null default '',
      cover_url    text,
      excerpt      text,
      tags         text[],
      is_page      boolean not null default false,
      published    boolean not null default false,
      published_at timestamptz null,
      created_at   timestamptz not null default now(),
      updated_at   timestamptz not null default now()
    )
  `);
  await db.query(`create index if not exists posts_published_idx on posts(published)`);
  await db.query(`create index if not exists posts_slug_idx      on posts(slug)`);
  await db.query(`create index if not exists posts_tags_gin      on posts using gin (tags)`);

  await db.query(`
    create or replace function set_updated_at() returns trigger as $$
    begin
      new.updated_at = now();
      if (new.published = true
          and (old.published is distinct from new.published)
          and new.published_at is null) then
        new.published_at = now();
      end if;
      return new;
    end $$ language plpgsql
  `);
  await db.query(`drop trigger if exists trg_set_updated_at on posts`);
  await db.query(`
    create trigger trg_set_updated_at
    before update on posts
    for each row execute procedure set_updated_at()
  `);
}

async function uniqueSlug(db: Awaited<ReturnType<typeof createDb>>, base: string) {
  const b = (base || "post").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "post";
  let slug = b, n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { rows } = await db.query<{ exists: boolean }>(
      `select exists(select 1 from posts where slug = $1) as exists`, [slug]
    );
    if (!rows[0]?.exists) return slug;
    n += 1; slug = `${b}-${n}`;
  }
}

export async function handleNewPost(req: Request, env: DbEnv): Promise<Response> {
  if (!authed(req, env)) return j({ error: "unauthorized" }, 401);

  const u = new URL(req.url);
  const qp = Object.fromEntries(u.searchParams.entries());
  let body: any = {};
  if (req.method === "POST") body = await req.json().catch(() => ({}));

  const title = body.title ?? qp.title ?? "첫 글: Hello World 👋";
  const body_md = body.body ?? body.body_md ?? qp.body ?? [
    "# 첫 글입니다",
    "",
    "이 에디터에서 작성/발행을 테스트해 보세요.",
    "",
    "- 왼쪽 목록에서 글을 선택해 불러올 수 있어요.",
    "- 상단 버튼으로 Draft 저장 / Publish!",
  ].join("\n");
  const baseSlug = body.slug ?? qp.slug ?? "hello-world";
  const tags = Array.isArray(body.tags)
    ? body.tags
    : (qp.tags ? String(qp.tags).split(",").map(s=>s.trim()).filter(Boolean) : ["diary","test"]);
  const excerpt = body.excerpt ?? qp.excerpt ?? "테스트 포스트입니다.";
  const is_page = !!(body.is_page ?? (qp.is_page === "1" || qp.type === "page"));
  const published = (body.published ?? (qp.published !== "false")) ? true : false;
  const published_at = published ? new Date().toISOString() : null;
  const cover_url = body.cover_url ?? qp.cover_url ?? null;

  let db: Awaited<ReturnType<typeof createDb>>;
  try { db = await createDb(env); } catch (e: any) {
    return j({ error: `DB init failed: ${e?.message || e}` }, 500);
  }

  try {
    await ensureSchema(db);
    const slug = await uniqueSlug(db, baseSlug);

    const { rows: ins } = await db.query(
      `insert into posts
       (title, body_md, slug, tags, excerpt, is_page, published, published_at, cover_url)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning id, slug, published, published_at`,
      [title, body_md, slug, tags, excerpt, is_page, published, published_at, cover_url]
    );

    return j({ ok: true, created: ins[0] });
  } catch (e: any) {
    return j({ error: e?.message || String(e) }, 500);
  }
}

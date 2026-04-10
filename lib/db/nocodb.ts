// lib/db/nocodb.ts
// NocoDB REST API v2 client — drop-in replacement for PostgreSQL queries
//
// 환경변수:
//   NOCODB_HOST      — NocoDB 서버 URL (예: https://db.eeruwang.me)
//   NOCODB_API_KEY   — xc-token 인증 토큰
//   NOCODB_TABLE_ID  — posts 테이블 ID (NocoDB 대시보드에서 확인)

import type { PostRow } from "./db.js";

// ──────────── Config ────────────

function getConfig() {
  const host = (process.env.NOCODB_HOST || "").replace(/\/+$/, "");
  const apiKey = process.env.NOCODB_API_KEY || "";
  const tableId = process.env.NOCODB_TABLE_ID || "";
  if (!host || !apiKey || !tableId) {
    throw new Error("[nocodb] Missing NOCODB_HOST, NOCODB_API_KEY, or NOCODB_TABLE_ID");
  }
  return { host, apiKey, tableId };
}

function headers(): Record<string, string> {
  const { apiKey } = getConfig();
  return {
    "accept": "application/json",
    "xc-token": apiKey,
    "Content-Type": "application/json",
  };
}

function recordsUrl(extra = ""): string {
  const { host, tableId } = getConfig();
  return `${host}/api/v2/tables/${tableId}/records${extra}`;
}

// ──────────── NocoDB Row → PostRow 변환 ────────────

function toPostRow(r: any): PostRow {
  // NocoDB는 필드명이 대소문자 그대로 올 수 있음
  // tags: NocoDB에서는 콤마 구분 문자열 또는 JSON 배열
  let tags: string[] | null = null;
  if (Array.isArray(r.tags)) {
    tags = r.tags;
  } else if (typeof r.tags === "string" && r.tags.trim()) {
    try {
      const parsed = JSON.parse(r.tags);
      tags = Array.isArray(parsed) ? parsed : r.tags.split(",").map((s: string) => s.trim()).filter(Boolean);
    } catch {
      tags = r.tags.split(",").map((s: string) => s.trim()).filter(Boolean);
    }
  }

  return {
    id: r.Id ?? r.id ?? 0,
    slug: r.slug || "",
    title: r.title || "",
    body_md: r.body_md || "",
    cover_url: r.cover_url || null,
    excerpt: r.excerpt || null,
    tags,
    is_page: r.is_page === true || r.is_page === 1 || r.is_page === "true",
    published: r.published === true || r.published === 1 || r.published === "true",
    published_at: r.published_at || null,
    created_at: r.created_at || r.CreatedAt || new Date().toISOString(),
    updated_at: r.updated_at || r.UpdatedAt || new Date().toISOString(),
  };
}

// PostRow → NocoDB 필드 변환
function toNocoFields(data: Partial<PostRow> & Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  if (data.title !== undefined) fields.title = data.title;
  if (data.body_md !== undefined) fields.body_md = data.body_md;
  if ((data as any).bodyMd !== undefined) fields.body_md = (data as any).bodyMd;
  if (data.slug !== undefined) fields.slug = data.slug;
  if (data.cover_url !== undefined) fields.cover_url = data.cover_url;
  if (data.excerpt !== undefined) fields.excerpt = data.excerpt;
  if (data.is_page !== undefined) fields.is_page = !!data.is_page;
  if (data.published !== undefined) fields.published = !!data.published;
  if (data.published_at !== undefined) fields.published_at = data.published_at;
  if (data.tags !== undefined) {
    // NocoDB에 콤마 구분 문자열로 저장
    fields.tags = Array.isArray(data.tags) ? data.tags.join(",") : String(data.tags || "");
  }
  return fields;
}

// ──────────── Public API (db.ts와 동일 시그니처) ────────────

export async function pingDb(): Promise<{ now: string }> {
  const { host, apiKey, tableId } = getConfig();
  // 간단히 1건 조회로 헬스체크
  const res = await fetch(`${host}/api/v2/tables/${tableId}/records?limit=1`, {
    headers: { accept: "application/json", "xc-token": apiKey },
  });
  if (!res.ok) throw new Error(`NocoDB ping failed: ${res.status}`);
  return { now: new Date().toISOString() };
}

export function driverKind(): string {
  return "nocodb";
}

export function asArrayRows<T>(res: any): T[] {
  if (Array.isArray(res)) return res;
  if (res && Array.isArray(res.rows)) return res.rows;
  if (res && Array.isArray(res.list)) return res.list;
  return [];
}

/** 목록 (게시글만, 발행된 것만) */
export async function listPosts(page = 1, perPage = 10): Promise<PostRow[]> {
  const limit = Math.max(1, Math.min(perPage, 200));
  const offset = (Math.max(1, page) - 1) * limit;
  const where = `(published,eq,true)~and(is_page,eq,false)`;
  const sort = `-published_at,-updated_at,-Id`;
  const url = `${recordsUrl()}?where=${encodeURIComponent(where)}&sort=${sort}&limit=${limit}&offset=${offset}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`NocoDB listPosts failed: ${res.status}`);
  const data = await res.json() as any;
  return (data.list || []).map(toPostRow);
}

/** 태그별 목록 */
export async function listByTag(tag: string, page = 1, perPage = 10): Promise<PostRow[]> {
  const limit = Math.max(1, Math.min(perPage, 200));
  const offset = (Math.max(1, page) - 1) * limit;
  // NocoDB where: tags 컬럼에서 like 검색
  const where = `(published,eq,true)~and(is_page,eq,false)~and(tags,like,%${tag}%)`;
  const sort = `-published_at,-updated_at,-Id`;
  const url = `${recordsUrl()}?where=${encodeURIComponent(where)}&sort=${sort}&limit=${limit}&offset=${offset}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`NocoDB listByTag failed: ${res.status}`);
  const data = await res.json() as any;
  return (data.list || []).map(toPostRow);
}

/** 슬러그로 조회 (포스트/페이지 공용) */
export async function getBySlug(slug: string): Promise<PostRow | null> {
  const where = `(slug,eq,${slug})`;
  const url = `${recordsUrl()}?where=${encodeURIComponent(where)}&limit=1`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return null;
  const data = await res.json() as any;
  const list = data.list || [];
  return list.length > 0 ? toPostRow(list[0]) : null;
}

/** 페이지 전용 */
export async function getPageBySlug(slug: string, opts?: { includeDraft?: boolean }): Promise<PostRow | null> {
  const includeDraft = !!opts?.includeDraft;
  let where = `(slug,eq,${slug})~and(is_page,eq,true)`;
  if (!includeDraft) where += `~and(published,eq,true)`;
  const url = `${recordsUrl()}?where=${encodeURIComponent(where)}&limit=1`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return null;
  const data = await res.json() as any;
  const list = data.list || [];
  return list.length > 0 ? toPostRow(list[0]) : null;
}

/** 포스트 전용 */
export async function getPostBySlug(slug: string, opts?: { includeDraft?: boolean }): Promise<PostRow | null> {
  const includeDraft = !!opts?.includeDraft;
  let where = `(slug,eq,${slug})~and(is_page,eq,false)`;
  if (!includeDraft) where += `~and(published,eq,true)`;
  const url = `${recordsUrl()}?where=${encodeURIComponent(where)}&limit=1`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return null;
  const data = await res.json() as any;
  const list = data.list || [];
  return list.length > 0 ? toPostRow(list[0]) : null;
}

// ──────────── CRUD (editor API에서 사용) ────────────

/** 전체 목록 (에디터용, 본문 제외) */
export async function nocoListAll(limit = 100, offset = 0, isEditor = false): Promise<PostRow[]> {
  const sort = `-published,-published_at,-updated_at,-Id`;
  let url: string;
  if (isEditor) {
    url = `${recordsUrl()}?sort=${sort}&limit=${limit}&offset=${offset}`;
  } else {
    const where = `(published,eq,true)~and(is_page,eq,false)`;
    url = `${recordsUrl()}?where=${encodeURIComponent(where)}&sort=${sort}&limit=${limit}&offset=${offset}`;
  }
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`NocoDB list failed: ${res.status}`);
  const data = await res.json() as any;
  return (data.list || []).map(toPostRow);
}

/** ID로 단건 조회 */
export async function nocoGetById(id: number): Promise<PostRow | null> {
  const url = `${recordsUrl()}/${id}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return null;
  const data = await res.json() as any;
  return toPostRow(data);
}

/** 레코드 생성 */
export async function nocoCreate(data: Record<string, any>): Promise<PostRow> {
  const fields = toNocoFields(data);
  if (!fields.title) fields.title = "(untitled)";
  if (!fields.slug) fields.slug = `post-${Date.now()}`;
  if (fields.published === undefined) fields.published = false;
  if (fields.is_page === undefined) fields.is_page = false;
  if (!fields.created_at) fields.created_at = new Date().toISOString();
  if (!fields.updated_at) fields.updated_at = new Date().toISOString();

  const res = await fetch(recordsUrl(), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NocoDB create failed: ${res.status} ${text}`);
  }
  const created = await res.json() as any;
  return toPostRow(created);
}

/** 레코드 수정 (Id 필수) */
export async function nocoUpdate(id: number, data: Record<string, any>): Promise<PostRow> {
  const fields = toNocoFields(data);
  fields.Id = id;
  fields.updated_at = new Date().toISOString();

  const res = await fetch(recordsUrl(), {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NocoDB update failed: ${res.status} ${text}`);
  }
  // PATCH 후 최신 데이터 조회
  return (await nocoGetById(id)) || toPostRow({ ...fields, id });
}

/** 레코드 삭제 */
export async function nocoDelete(id: number): Promise<void> {
  const res = await fetch(recordsUrl(), {
    method: "DELETE",
    headers: headers(),
    body: JSON.stringify({ Id: id }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NocoDB delete failed: ${res.status} ${text}`);
  }
}

/** slug 중복 체크 */
export async function nocoIsSlugTaken(slug: string, excludeId?: number): Promise<boolean> {
  const where = `(slug,eq,${slug})`;
  const url = `${recordsUrl()}?where=${encodeURIComponent(where)}&limit=1`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return false;
  const data = await res.json() as any;
  const list = data.list || [];
  if (!list.length) return false;
  if (excludeId && list[0].Id === excludeId) return false;
  return true;
}

/** 설정 테이블 대용 — NocoDB에서는 특수 레코드로 관리하거나 env로 대체 */
// NocoDB 모드에서는 settings를 환경변수로 처리
export async function nocoGetSetting(key: string): Promise<string | null> {
  // 환경변수에서 읽기 (SETTING_key_name 형태)
  const envKey = `SETTING_${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return process.env[envKey] || null;
}

export async function nocoSetSetting(_key: string, _value: string): Promise<void> {
  // NocoDB 모드에서는 설정 쓰기를 무시 (환경변수는 런타임에 변경 불가)
  console.warn(`[nocodb] setSetting ignored in NocoDB mode: ${_key}`);
}

// lib/db/nocodb.ts
// NocoDB REST API client — drop-in replacement for PostgreSQL queries
//
// 환경변수:
//   NOCODB_HOST      — NocoDB 서버 URL (예: https://db.eeruwang.me)
//   NOCODB_API_KEY   — xc-token 인증 토큰
//   NOCODB_TABLE_ID  — posts 테이블 ID (NocoDB 대시보드에서 확인)
//
// API 버전 자동 감지: v2 먼저 시도 → 실패 시 v1 fallback

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

// API 버전 캐싱 (첫 성공한 버전을 기억)
let _apiVersion: "v2" | "v1" | null = null;

function recordsUrlV2(extra = ""): string {
  const { host, tableId } = getConfig();
  return `${host}/api/v2/tables/${tableId}/records${extra}`;
}
function recordsUrlV1(extra = ""): string {
  const { host, tableId } = getConfig();
  // v1 경로: /api/v1/db/data/v1/noco/{projectId}/{tableName}/records
  // 하지만 테이블 ID만 있을 때는 /api/v1/db/meta/tables/{tableId}/rows도 가능
  return `${host}/api/v1/db/data/noco/${tableId}/records${extra}`;
}
function recordsUrl(extra = ""): string {
  if (_apiVersion === "v1") return recordsUrlV1(extra);
  return recordsUrlV2(extra);
}

/** 양쪽 버전을 시도하여 성공하는 쪽을 사용 */
async function fetchWithFallback(
  buildUrl: (version: "v2" | "v1") => string,
  init?: RequestInit
): Promise<Response> {
  // 이미 감지된 버전이 있으면 그것만 사용
  if (_apiVersion) {
    return fetch(buildUrl(_apiVersion), init);
  }

  // v2 먼저 시도
  const v2Url = buildUrl("v2");
  const v2Res = await fetch(v2Url, init);
  if (v2Res.ok) {
    _apiVersion = "v2";
    console.log("[nocodb] API version: v2");
    return v2Res;
  }
  // 404면 v1 시도
  if (v2Res.status === 404) {
    const v1Url = buildUrl("v1");
    const v1Res = await fetch(v1Url, init);
    if (v1Res.ok) {
      _apiVersion = "v1";
      console.log("[nocodb] API version: v1");
      return v1Res;
    }
    // v1도 404면 두 에러 모두 기록
    const v1Text = await v1Res.text().catch(() => "");
    throw new Error(
      `NocoDB 404 on both v2 and v1. ` +
      `v2: ${v2Url} | v1: ${v1Url} | v1 body: ${v1Text.slice(0, 200)}`
    );
  }
  // v2가 404가 아니면 그 응답을 그대로 반환
  return v2Res;
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
  const res = await fetchWithFallback(
    (v) => (v === "v1" ? recordsUrlV1("?limit=1") : recordsUrlV2("?limit=1")),
    { headers: headers() }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NocoDB ping failed: ${res.status} :: ${text.slice(0, 300)}`);
  }
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
  // 충분히 많이 가져와서 메모리 필터 (NocoDB where 문법 이슈 회피)
  const rows = await nocoListAll(Math.max(limit * 3, 50), 0, false);
  return rows.slice(offset, offset + limit);
}

/** 태그별 목록 */
export async function listByTag(tag: string, page = 1, perPage = 10): Promise<PostRow[]> {
  const limit = Math.max(1, Math.min(perPage, 200));
  const offset = (Math.max(1, page) - 1) * limit;
  const all = await nocoListAll(500, 0, false);
  const filtered = all.filter((r: PostRow) =>
    Array.isArray(r.tags) && r.tags.some(t => String(t).toLowerCase() === tag.toLowerCase())
  );
  return filtered.slice(offset, offset + limit);
}

/** 슬러그로 조회 (포스트/페이지 공용) — 메모리 필터 */
export async function getBySlug(slug: string): Promise<PostRow | null> {
  const all = await nocoListAll(500, 0, true);
  const match = all.find(r => String(r.slug || "").toLowerCase() === slug.toLowerCase());
  return match || null;
}

/** 페이지 전용 */
export async function getPageBySlug(slug: string, opts?: { includeDraft?: boolean }): Promise<PostRow | null> {
  const includeDraft = !!opts?.includeDraft;
  const all = await nocoListAll(500, 0, true);
  return all.find(r =>
    String(r.slug || "").toLowerCase() === slug.toLowerCase() &&
    r.is_page === true &&
    (includeDraft || r.published === true)
  ) || null;
}

/** 포스트 전용 */
export async function getPostBySlug(slug: string, opts?: { includeDraft?: boolean }): Promise<PostRow | null> {
  const includeDraft = !!opts?.includeDraft;
  const all = await nocoListAll(500, 0, true);
  return all.find(r =>
    String(r.slug || "").toLowerCase() === slug.toLowerCase() &&
    r.is_page !== true &&
    (includeDraft || r.published === true)
  ) || null;
}

// ──────────── CRUD (editor API에서 사용) ────────────

/** 전체 목록 (에디터용, 본문 제외) */
export async function nocoListAll(limit = 100, offset = 0, isEditor = false): Promise<PostRow[]> {
  const res = await fetchWithFallback(
    (v) => (v === "v1" ? recordsUrlV1(`?limit=${limit}&offset=${offset}`) : recordsUrlV2(`?limit=${limit}&offset=${offset}`)),
    { headers: headers() }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[nocodb] nocoListAll failed:", res.status, text);
    throw new Error(`NocoDB list failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json() as any;
  let rows = (data.list || []).map(toPostRow);

  // 에디터가 아니면 발행된 포스트만 (NocoDB 컬럼명이 다를 경우 대비)
  if (!isEditor) {
    rows = rows.filter((r: PostRow) => r.published === true && r.is_page !== true);
  }

  // 정렬: 발행일 내림차순 (빈 값은 뒤로)
  rows.sort((a: PostRow, b: PostRow) => {
    const da = new Date(a.published_at || a.updated_at || a.created_at || 0).getTime();
    const db = new Date(b.published_at || b.updated_at || b.created_at || 0).getTime();
    return db - da;
  });

  return rows;
}

/** ID로 단건 조회 */
export async function nocoGetById(id: number): Promise<PostRow | null> {
  const res = await fetchWithFallback(
    (v) => (v === "v1" ? `${recordsUrlV1()}/${id}` : `${recordsUrlV2()}/${id}`),
    { headers: headers() }
  );
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
  const all = await nocoListAll(500, 0, true);
  const found = all.find(r => String(r.slug || "").toLowerCase() === slug.toLowerCase());
  if (!found) return false;
  if (excludeId && found.id === excludeId) return false;
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

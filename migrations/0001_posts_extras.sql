-- drizzle/0001_posts_extras.sql
-- 새 DB를 같은 구조/동작으로 맞추는 추가 마이그레이션

-- (선택) 한글 혼용 텍스트 정규화에 도움이 되면 unaccent를 사용
-- create extension if not exists unaccent;

-- 컬럼 기본값 보강 (Drizzle DSL로도 가능하지만 DB 레벨에 확정)
alter table if exists posts
  alter column tags set default '{}'::text[];

alter table if exists posts
  alter column attachments set default '[]'::jsonb;

-- slug를 대소문자 구분 없이 유니크 보장
create unique index if not exists ux_posts_slug_lower on posts (lower(slug));

-- 정렬/필터 최적화 인덱스(부분 인덱스 포함)
do $$ begin
  if not exists (
    select 1 from pg_class c join pg_indexes i on i.indexname = 'idx_posts_published_only'
  ) then
    create index idx_posts_published_only on posts (published_at desc)
      where published = true and is_page = false;
  end if;
end $$;

-- 태그 배열 GIN 인덱스
create index if not exists idx_posts_tags on posts using gin (tags);

-- updated_at 자동 갱신
create or replace function trg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists set_updated_at on posts;
create trigger set_updated_at
before update on posts
for each row execute function trg_set_updated_at();

-- published=true인데 published_at 비어 있으면 자동 채우기
create or replace function trg_fill_published_at()
returns trigger language plpgsql as $$
begin
  if (new.published is true) and (new.published_at is null) then
    new.published_at := now();
  end if;
  return new;
end$$;

drop trigger if exists fill_published_at on posts;
create trigger fill_published_at
before insert or update on posts
for each row execute function trg_fill_published_at();

-- tags 정규화(소문자/trim/중복 제거)
create or replace function normalize_tags(arr text[])
returns text[] language sql immutable as $$
  select case
    when arr is null then '{}'
    else (
      select coalesce(array_agg(distinct t order by t), '{}')
      from (
        select nullif(btrim(lower(x)), '') as t
        from unnest(arr) as x
      ) s
      where t is not null
    )
  end
$$;

create or replace function trg_normalize_tags()
returns trigger language plpgsql as $$
begin
  new.tags := normalize_tags(new.tags);
  return new;
end$$;

drop trigger if exists normalize_tags_on_posts on posts;
create trigger normalize_tags_on_posts
before insert or update of tags on posts
for each row execute function trg_normalize_tags();

-- (선택) slug를 항상 소문자로 강제하고 싶다면
create or replace function trg_slug_lower()
returns trigger language plpgsql as $$
begin
  if new.slug is not null then
    new.slug := lower(new.slug);
  end if;
  return new;
end$$;

drop trigger if exists slug_lower_on_posts on posts;
create trigger slug_lower_on_posts
before insert or update of slug on posts
for each row execute function trg_slug_lower();

-- lib/db/schema.sql
-- 블로그 스키마 (PostgreSQL)
-- 개선: tags 기본값 캐스팅, slug 소문자 강제, 트랜잭션 래핑

BEGIN;

-- ============ 테이블 ============
CREATE TABLE IF NOT EXISTS posts (
  id           BIGSERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  body_md      TEXT NOT NULL DEFAULT '',
  cover_url    TEXT,
  excerpt      TEXT,
  tags         TEXT[] NOT NULL DEFAULT '{}'::text[],   -- ← 명시적 캐스팅
  is_page      BOOLEAN NOT NULL DEFAULT FALSE,
  published    BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attachments  JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT chk_slug_lower CHECK (slug = lower(slug)) -- ← slug는 항상 소문자
);

-- ============ 인덱스 ============
CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts (published_at);
CREATE INDEX IF NOT EXISTS idx_posts_is_page      ON posts (is_page);
-- 태그 검색(any) 최적화용(선택)
CREATE INDEX IF NOT EXISTS idx_posts_tags         ON posts USING GIN (tags);

-- ============ 트리거 함수 ============
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_published_at() RETURNS TRIGGER AS $$
BEGIN
  -- insert 시 published=true 이고 published_at 비어있으면 now()
  IF TG_OP = 'INSERT' THEN
    IF NEW.published = TRUE AND NEW.published_at IS NULL THEN
      NEW.published_at := NOW();
    END IF;
  ELSE
    -- update 시 false->true 로 변경되고 published_at 비어있으면 now()
    IF COALESCE(OLD.published, FALSE) = FALSE
       AND NEW.published = TRUE
       AND NEW.published_at IS NULL THEN
      NEW.published_at := NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============ 트리거 ============
DROP TRIGGER IF EXISTS trg_posts_set_updated_at   ON posts;
CREATE TRIGGER trg_posts_set_updated_at
BEFORE UPDATE ON posts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_posts_set_published_at ON posts;
CREATE TRIGGER trg_posts_set_published_at
BEFORE INSERT OR UPDATE ON posts
FOR EACH ROW EXECUTE FUNCTION set_published_at();

COMMIT;

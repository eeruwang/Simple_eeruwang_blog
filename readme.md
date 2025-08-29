# Every Eight Seconds

간단한 블로그·노트 엔진. 로컬 개발은 Express, 서버리스 배포는 Vercel Functions, 컨테이너 배포는 Docker/Compose를 사용합니다. 데이터는 PostgreSQL 하나로 일원화되어 있고, 글 작성·게시를 위한 최소 에디터가 포함되어 있습니다.

## 특징

* 인덱스(/), 태그(/tag/\:tag), 글(/post/\:slug), 페이지(/page/\:slug) SSR 렌더링
* RSS 피드(/rss.xml)
* 비밀번호 기반 미니 에디터(HTML 한 장 + editor.js)
* HTML은 no-store, 정적 에셋은 캐시 우선 전략
* BibTeX 파일을 불러와 본문 내 \[@key]를 참조 목록으로 치환
* 단일 `.env`로 로컬/도커/Vercel 모두 구성 가능

## 요구 사항

* Node.js 20+
* PostgreSQL 15+ (개발용은 Docker로 함께 실행 가능)
* 선택: Docker/Compose v2, Vercel 계정

## 빠른 시작(로컬)

1. 의존성 설치

   ```bash
   npm i
   ```
2. 환경 변수 준비(저장소에는 `.env.example`만 커밋)

   ```bash
   cp .env.example .env
   # 필요 값 수정
   ```
3. 데이터베이스 준비(로컬 Postgres 사용 시)

   ```bash
   # psql이 로컬에 설치되어 있어야 합니다
   npm run db:setup
   ```
4. 개발 서버

   ```bash
   npm run dev
   # http://localhost:3000
   ```

## Docker로 실행

Compose 예시(요약):

```yaml
services:
  db:
    image: postgres:17
    container_name: blog_db
    environment:
      POSTGRES_DB: notes
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      TZ: Europe/London
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./lib/db/schema.sql:/docker-entrypoint-initdb.d/00_schema.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d notes"]
      interval: 10s
      timeout: 3s
      retries: 12
      start_period: 10s

  web:
    build: .
    container_name: blog_web
    depends_on:
      db:
        condition: service_healthy
    environment:
      NODE_ENV: production
      TZ: Europe/London
      SITE_NAME: "Every Eight Seconds"
      SITE_URL: "http://localhost:3000"
      ALLOW_DEBUG: "false"
      EDITOR_PASSWORD: "CHANGE_ME"
      DATABASE_URL: "postgres://app:app@db:5432/notes?sslmode=disable"
    ports:
      - "3000:3000"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/api/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval: 10s
      timeout: 3s
      retries: 12
      start_period: 10s

volumes:
  pgdata:
```

실행:

```bash
npm run docker:up
# 종료
npm run docker:down
```

## Vercel 배포

1. 저장소 연결 후 환경 변수 설정

   * 필수: `SITE_URL`, `SITE_NAME`, `EDITOR_PASSWORD`, `DATABASE_URL` (Neon 등 매니지드 Postgres 권장, sslmode=require)
2. `vercel.json`의 리라이트 규칙으로 모든 경로가 `api/[[...all]]`로 위임됩니다.
3. 빌드

   * Build Command: `npm run build`
   * Output: TypeScript → `dist/`, Vercel Node 20 런타임 사용

## 스크립트

* `npm run dev` — 개발 서버(Express)
* `npm run typecheck` — 타입 검사
* `npm run build` — TS 컴파일
* `npm run start` — 프로덕션 서버(Express)
* `npm run db:setup` — `lib/db/schema.sql`을 현재 `DATABASE_URL`에 적용
* `npm run docker:up` / `docker:down` — Compose 올리고/내리기

## 환경 변수

`.env.example` 참고. 주요 키만 정리합니다.

* `SITE_URL` — RSS/OG 절대 URL 생성에 사용
* `SITE_NAME` — 사이트 타이틀
* `NOTES_TAGS` — 상단 태그 레일 기본값(쉼표 구분)
* `ALLOW_DEBUG` — 개발 중에는 `true` 권장
* `TZ` — 서버 타임존
* `EDITOR_PASSWORD` — 에디터 보호용 비밀번호
* `EDITOR_ASSET_VER` — 에디터 정적파일 캐시버스터(숫자 올려 강제 갱신)
* `BIBTEX_FILE`, `BIBTEX_STYLE` — BibTeX 경로/스타일(옵션)
* `DATABASE_URL` — Postgres 접속 문자열(Neon/Supabase 등은 `sslmode=require`)
* 선택: `NEON_DATABASE_URL` — 존재하면 `DATABASE_URL` 대신 우선 사용

## 프로젝트 구조(요약)

```
api/[[...all]].ts        # Vercel 엔드포인트(모든 경로 위임)
lib/db/db.ts             # 교차 런타임 Postgres 클라이언트
lib/db/schema.sql        # 초기 스키마 및 인덱스
lib/pages/editor.ts      # 에디터 HTML
lib/api/editor.ts        # 에디터 CRUD API
lib/render/*             # 레이아웃/OG/태그/배너 유틸
public/assets/*          # CSS/JS(에디터/사이트)
routes/public/*          # SSR 라우트(index/tag/post/page/rss)
server/server.ts         # 로컬 Express 엔트리
vercel.json              # Vercel 라우팅 규칙
```

## 에디터 사용법

* 주소: `/editor`
* 비밀번호 입력 후 로컬 스토리지에 토큰 저장
* API 호출 시 `x-editor-token` 헤더가 자동 첨부됩니다(editor.js)
* 게시 시 `published=true`와 `published_at`이 설정됩니다

간단 검사:

```bash
curl -i http://localhost:3000/api/ping
# 200 {"ok":true}
```

## 보안·캐시·CORS

* 공통 보안 헤더를 Express/Vercel 양쪽에서 설정
* HTML 응답은 `cache-control: no-store` 강제
* 정적 파일은 `public/assets`에서 서빙(캐시 우선)
* 에디터 API는 기본 동일 오리진만 허용. 외부 도메인에서 사용하려면 허용 오리진을 코드에서 확장하세요

## 트러블슈팅

* `docker-compose.yml`은 파일 포맷 버전 키가 필요 없습니다. 불명확한 값(예: `0.5`)을 넣지 마세요
* 에디터 JS/CSS가 갱신되지 않을 때: `EDITOR_ASSET_VER` 값을 올려 브라우저 캐시 무효화
* Postgres 연결 실패: `DATABASE_URL` 호스트·포트·DB명 확인, Docker의 경우 서비스명 `db` 사용
* Vercel에서 커넥션 에러: Neon 등 매니지드 DB 사용, `sslmode=require` 확인

## 라이선스

원하는 라이선스를 선택해 이 섹션을 교체하세요.

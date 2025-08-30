# 이루왕 심플 블로그

개인용 블로그·노트 엔진입니다. 로컬 개발은 **Express**, 서버리스 배포는 **Vercel Functions**를 사용하고, 데이터는 **PostgreSQL** 하나로 일원화되어 있습니다. 글 작성·게시를 위한 최소 에디터가 포함됩니다.

> **주의**
>
> - 이 프로젝트는 **개인용**으로 작성되었습니다. 문서나 코드에 **누락/오류가 있을 수** 있으며, 배포·운영에 따른 책임은 사용자에게 있습니다.
> - **Docker/Compose 배포는 개발 예정**입니다. 본 문서에서는 의도적으로 상세 내용을 생략합니다.

## Vercel Install
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Feeruwang%2FSimple_eeruwang_blog&integration-ids=NEON_INTEGRATION_ID)


---

## 특징

- **SSR 라우팅**
  - 인덱스: `/`
  - 태그: `/tag/:tag`
  - 글(포스트): `/post/:slug`
  - 페이지: `/:slug` (DB `is_page=true`)
  - RSS: `/rss.xml`
  - 에디터: `/editor` (비밀번호 보호)
- **에디터**: 한 장짜리 HTML + `editor.js`, 비밀번호 기반 간단 인증
- **캐시 전략**: HTML 응답은 `cache-control: no-store`, 정적 에셋은 캐시 우선
- **참조 처리**: BibTeX 파일을 불러와 본문 내 `[@key]` 표기를 참고문헌으로 치환
- **이미지 정렬**: 본문에서 단독 이미지(또는 링크로 감싼 단독 이미지)를 **자동 중앙 정렬**, `figure/figcaption` 기본 스타일 제공
- **환경 구성 단순화**: 단일 `.env`로 로컬/Vercel 모두 구성 가능

---

## 요구 사항

- **Node.js 20+**
- **PostgreSQL 15+**  
  (Neon/Supabase 등 매니지드 Postgres 권장, `sslmode=require`)
- (선택) **Vercel 계정**

> Docker/Compose는 **개발 예정**입니다. 배포 이미지는 추후 제공됩니다.

---

## 빠른 시작(로컬)

1) **의존성 설치**
```bash
npm i
```

2) **환경 변수 준비 (.env.example를 복사 후 값 편집)**
```
cp .env.example .env
```

3) **데이터베이스 초기화 (로컬 Postgres 사용 시)**
```
npm run db:setup
```

4) **개발 서버 실행**
```
npm run dev
# http://localhost:3000
```

5) **에디터 사용**
- 주소: http://localhost:3000/editor
- 최초 진입 시 비밀번호 입력 → 로컬 스토리지에 토큰 저장 → 이후 CRUD 가능

## Vercel 배포
1. 환경 변수 설정
  필수: SITE_URL, SITE_NAME, EDITOR_PASSWORD, DATABASE_URL
  권장: 매니지드 Postgres(Neon 등) 사용 + 접속 문자열에 sslmode=require
2. 라우팅
  vercel.json 리라이트로 모든 경로가 api/[[...all]]로 위임됩니다.
3. 빌드/런타임
  Build Command: npm run build
  산출물: TypeScript → dist/
  런타임: Node 20

## 스크립트
npm run dev — 개발 서버(Express)
npm run typecheck — 타입 검사
npm run build — TS 컴파일
npm run start — 프로덕션 서버(Express)
npm run db:setup — lib/db/schema.sql을 현재 DATABASE_URL에 적용

## Docker 관련 스크립트/문서는 개발 예정입니다.

## 라우팅 동작 요약
- 포스트: /post/:slug
- 페이지: /:slug (목록에는 나타나지 않음 → 상단 네비에 수동 링크 권장)
- 드래프트 미리보기: ?preview=1 (또는 ?draft=1)
- 공개 API: GET /api/posts?slug=... 로 단일 항목 확인 가능

## 환경 변수 (.env.example를 참고하세요. 주요 키만 요약합니다.)
- SITE_URL — RSS/OG 절대 URL 생성에 사용
- SITE_NAME — 사이트 타이틀
- NOTES_TAGS — 상단 태그 레일 기본값(쉼표 구분)
- ALLOW_DEBUG — 개발 중 true 권장
- EDITOR_PASSWORD — 에디터 보호용 비밀번호
- EDITOR_ASSET_VER — 에디터 정적파일 캐시 버스터(숫자 증가로 강제 갱신)
- BIBTEX_FILE, BIBTEX_STYLE — BibTeX 경로/스타일(옵션)
- DATABASE_URL — Postgres 접속 문자열 (Neon 등은 sslmode=require)
- (선택) NEON_DATABASE_URL — 존재 시 우선 사용하도록 코드에서 처리 가능

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

## 로드맵(예정)
- [x] BIBTEX 올리기 버튼 고치기
- [ ] Docker/Compose 배포 문서 및 이미지
- [ ] 검색·접근성 개선
- [ ] 헬스체크/관측(로그·메트릭) 가이드
- [ ] 404/500 커스텀 페이지
- [ ] 간단한 사이트맵 생성기

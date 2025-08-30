# 이루왕 심플 블로그

개인용 블로그·노트 엔진입니다. 로컬 개발은 Express, 서버리스 배포는 Vercel Functions, 데이터는 PostgreSQL 하나로 일원화했습니다. 글 작성·게시를 위한 최소 에디터가 포함됩니다.

## 기능

- 마크다운 기반 경량 블로그 & 인라인 미리보기
- BibTeX 인용: 에디터에서 reference.bib 업로드 → 본문 내 [@key] or [-@key] 자동 치환
- 스타일: harvard(기본) / chicago(author-date) / apa(lite)
- 풋노트 다음에 Bibliography 섹션이 본문 컨테이너 안에 렌더되어 페이지 전환(샤락샤락)에 함께 포함
- 제목은 볼드 문장, 항목은 문단 단위 + 행걸이 들여쓰기(숫자/불릿 없음)
- 각주(footnote): 마우스오버 툴팁 + 하단 목록 자동 생성
- 이미지 업로드/정렬: 단독 이미지 자동 중앙, figure/figcaption 기본 스타일
- 부드러운 페이지 전환, 기본 SEO 메타, 태그·RSS, 커버 이미지
- 에디터: 한 장짜리 HTML(+editor.js), 비밀번호 기반 간단 인증
- 업로드: Vercel Blob 사용(이미지·BibTeX)

> **주의**
> 개인용 프로젝트입니다. 문서/코드에 누락·오류가 있을 수 있으며, 배포/운영 책임은 사용자에게 있습니다.
> Docker/Compose 배포는 예정입니다.

## Vercel Install
[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Feeruwang%2FSimple_eeruwang_blog&integration-ids=NEON_INTEGRATION_ID)

1. 환경 변수
   - 필수: SITE_URL, SITE_NAME, EDITOR_PASSWORD, DATABASE_URL, BLOB_READ_WRITE_TOKEN
   - 권장: 매니지드 Postgres + 접속 문자열 sslmode=require
2. 라우팅
   - vercel.json 리라이트로 모든 경로가 api/[[...all]]로 위임
3. 빌드/런타임
   - Build: npm run build (TS → dist/)
   - Runtime: Node 20

---

## 특징

- **SSR 라우팅**
  - 인덱스: `/`
  - 태그: `/tag/:tag`
  - 글(포스트): `/post/:slug`
  - 페이지: `/:slug` (DB `is_page=true`)
  - RSS: `/rss.xml`
  - 에디터: `/editor` (비밀번호 보호)
- **캐시 전략**: HTML 응답은 `cache-control: no-store`, 정적 에셋은 캐시 우선
- **참조 처리**: BibTeX 파일을 불러와 본문 내 `[@key]` 표기를 참고문헌으로 치환
- **환경 구성 단순화**: 단일 `.env`로 로컬/Vercel 모두 구성 가능

---

## 요구 사항
- Node.js 20+
- PostgreSQL 15+ (Neon/Supabase 등 매니지드 권장, sslmode=require)
- (선택) **Vercel 계정**

> Docker/Compose는 **개발 예정**입니다. 배포 이미지는 추후 제공됩니다.

1) **에디터 사용**
- 주소: http://localhost:3000/editor
- 최초 진입 시 비밀번호 입력 → 로컬 스토리지에 토큰 저장 → 이후 CRUD 가능

## Docker 관련 스크립트/문서는 개발 예정입니다.


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
api/[[...all]].ts          # Vercel 엔트리(모든 경로 위임)
public/assets/*            # 사이트 CSS/JS
server/server.ts           # 로컬 Express 엔트리
vercel.json                # Vercel 리라이트
src/
  routes/
    pageview.ts            # 본문 렌더(풋노트 → Bibliography → 전환 컨테이너 내 주입)
    public/
      post.ts              # /post/:slug
      page.ts              # /:slug
      index.ts             # /
      tag.ts               # /tag/:tag
      rss.ts               # /rss.xml
  lib/
    api/editor.ts          # 에디터 CRUD + 업로드
    bibtex/                # 파서/치환/렌더(스타일: harvard/chicago/apa)
    render/                # 레이아웃/OG/태그/배너
    db/                    # DB 클라이언트 + 스키마
    markdown.ts            # md → safe HTML
    util.ts                # withBibliography 등 유틸
```
## 인용 문법(요약)
- [@key] → (Author, Year)
- [-@key] → (Year)
- [@a; @b] → 여러 개
- [@key, p. 12] → 위치 지정

## 로드맵(예정)
- [x] BIBTEX 올리기 버튼 고치기
- [ ] Docker/Compose 배포 문서 및 이미지
- [ ] 검색·접근성 개선
- [ ] 헬스체크/관측(로그·메트릭) 가이드
- [ ] 404/500 커스텀 페이지
- [ ] 간단한 사이트맵 생성기

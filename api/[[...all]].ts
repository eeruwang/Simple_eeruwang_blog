// api/[[...all]].ts
// Vercel catch-all 엔트리. 실제 구현은 lib/http/handler.ts에 있습니다.
// (서버/Express 엔트리도 같은 파일을 재사용합니다.)
export { default, config } from "../lib/http/handler.js";

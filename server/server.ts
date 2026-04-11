// server/server.ts
// 로컬/Docker용 Express 엔트리.
// 이 파일은 api/[[...all]].ts의 Vercel 스타일 handler를 그대로 재사용합니다.
// 과거에는 이 파일에 handler 구현이 통째로 복제돼 있었고, 기본 export만 있어
// `tsx server/server.ts`나 `node dist/server/server.js`로 실행해도 서버가
// 뜨지 않는 상태였습니다. 이제는 Express로 정식 부팅합니다.

import express from "express";
import type { Request as ExReq, Response as ExRes, NextFunction } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../lib/http/handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Body parsers — Vercel handler는 req.body가 이미 파싱돼 있는 것을 기대합니다.
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));
app.use(express.raw({ type: "application/octet-stream", limit: "12mb" }));

// 정적 파일: /assets/* 및 기타 public/
const publicDir = path.resolve(__dirname, "..", "public");
app.use(
  express.static(publicDir, {
    maxAge: "1h",
    etag: true,
    // HTML은 캐시 안함
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  })
);

// 모든 경로를 Vercel 핸들러로 위임
app.all("*", async (req: ExReq, res: ExRes, next: NextFunction) => {
  try {
    // Vercel 타입은 VercelRequest/Response지만 런타임은 Node의 http.IncomingMessage/
    // ServerResponse이고 Express 객체도 동일 인터페이스를 구현하므로 캐스팅만으로 충분.
    await handler(req as any, res as any);
  } catch (err) {
    next(err);
  }
});

// 에러 핸들러
app.use((err: unknown, _req: ExReq, res: ExRes, _next: NextFunction) => {
  console.error("[server] unhandled error:", err);
  if (res.headersSent) return;
  const debug = String(process.env.ALLOW_DEBUG || "").toLowerCase() === "true";
  const msg = (err as any)?.message || String(err);
  res.status(500).type("text/plain").send(debug ? `Internal Error: ${msg}` : "Internal Error");
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://127.0.0.1:${port}`);
});

// Vercel 호환: 기본 export는 여전히 handler 함수로 노출
export default handler;

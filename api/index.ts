// api/editor/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { renderEditorHTML } from "../lib/pages/editor.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 1) 메서드 가드 (GET/HEAD만 허용)
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(405);
      res.setHeader("Allow", "GET, HEAD");
      return res.json({ error: "method_not_allowed" });
    }

    const html = renderEditorHTML({
      version: process.env.EDITOR_ASSET_VER || "v8",
    });

    // 2) 공통 헤더
    res.status(200);
    res.setHeader("content-type", "text/html; charset=utf-8");
    // 캐시: 편집기는 항상 최신이 좋음
    res.setHeader("cache-control", "no-store, max-age=0, must-revalidate");
    // 보안 헤더 (필요 최소)
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "same-origin");
    res.setHeader("x-frame-options", "SAMEORIGIN");

    // 3) HEAD 요청이면 본문 없이 종료
    if (req.method === "HEAD") return res.end();

    // 4) 본문 전송
    return res.send(html);
  } catch (e: any) {
    res.status(500);
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.send(JSON.stringify({ error: e?.message || String(e) }));
  }
}

# ---- build ----
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:20-slim AS runner
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

# 런타임 의존성만
COPY package*.json ./
RUN npm ci --omit=dev

# 빌드 산출물 + 정적 자산
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# 비루트로 실행
USER node

EXPOSE 3000

# 웹 헬스체크 (/api/ping 사용)
HEALTHCHECK --interval=10s --timeout=3s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/ping').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/server.js"]

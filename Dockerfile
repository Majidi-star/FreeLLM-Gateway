FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig*.json vite.config.ts ./
RUN npm ci

COPY src ./src
COPY index.html ./

RUN npm run build && npm run build:web

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-web ./dist-web

EXPOSE 8787 8788 8789 8790

CMD ["node", "dist/api/server.js"]

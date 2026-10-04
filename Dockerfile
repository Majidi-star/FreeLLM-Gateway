FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig*.json vite.config.ts tailwind.config.ts postcss.config.js ./
RUN npm ci

COPY src ./src
COPY scripts ./scripts
COPY index.html ./

RUN npm run build && npm run build:web

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/data/goalroute.db

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-web ./dist-web

RUN mkdir -p /app/data && chown -R node:node /app

VOLUME ["/app/data"]

USER node

EXPOSE 8787 8788 8789 8790

CMD ["node", "dist/api/server.js"]

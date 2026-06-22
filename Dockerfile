FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/app/data/banki.db MEDIA_DIR=/app/public/media
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
RUN mkdir -p /app/data /app/public/media && chown -R nextjs:nodejs /app/data /app/public/media
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

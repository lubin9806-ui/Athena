FROM node:24.21.0-bookworm AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24.21.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node config ./config
COPY --chown=node:node src ./src

RUN mkdir -p /app/storage/backups /app/storage/exports \
    && chown -R node:node /app/storage

USER node
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 10000}/health/live`).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "src/index.js"]

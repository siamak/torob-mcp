# syntax=docker/dockerfile:1

# Build stage: install with the lockfile and no install scripts, then bundle.
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY apps/node/package.json apps/node/
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build

# Runtime stage: only the bundle and production dependencies.
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    TOROB_LOG_LEVEL=info

# tini reaps zombies and forwards signals, so the container stops cleanly.
RUN apk add --no-cache tini

COPY --from=build /app/apps/node/dist ./dist

# node:alpine ships an unprivileged `node` user; the image never runs as root.
USER node

# Works with --read-only: nothing is written to disk, and the cache is in memory.
EXPOSE 3000

# Binds all interfaces because a container's loopback is not reachable from outside; auth is
# therefore required. Set TOROB_AUTH_TOKEN, or pass --insecure deliberately.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--", "node", "/app/dist/bin.mjs"]
CMD ["--http", "--host", "0.0.0.0", "--port", "3000"]

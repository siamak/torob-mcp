# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Base image: gcr.io/distroless/nodejs22-debian12:nonroot
#
# Chosen over node:22-alpine deliberately. Distroless carries no shell, no package manager and no
# busybox, so a command-injection or dependency foothold has nothing to pivot with. The `:nonroot`
# tag runs as uid 65532 by default rather than relying on a USER line being correct.
#
# The cost is that debugging inside the container is not possible - there is no `docker exec sh`.
# That is the right trade for a server whose whole job is fetching untrusted third-party content on
# someone else's machine. Use `:debug` tags locally if you need a shell.
# ---------------------------------------------------------------------------

# Build stage keeps a full toolchain; none of it reaches the runtime image.
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN corepack enable

# Copy manifests first so the dependency layer caches independently of source.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY apps/node/package.json apps/node/

# --ignore-scripts matches CI: no package may run code at install time.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build

# `pnpm deploy` produces a self-contained directory with only production dependencies, which is
# what the runtime stage needs: the bundle inlines @torob-mcp/core but keeps zod, the MCP SDK,
# pino and lru-cache external, so node_modules must be present.
RUN pnpm deploy --filter torob-mcp --prod --legacy /deploy

# ---------------------------------------------------------------------------
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    TOROB_LOG_LEVEL=info

COPY --from=build /deploy/dist ./dist
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /deploy/package.json ./package.json

# Compatible with `--read-only`: nothing is written to disk, the cache lives in memory, and there
# is no cookie jar or state directory. Run with `--read-only --tmpfs /tmp` if you want belt and
# braces.
EXPOSE 3000

# Exec form, because distroless has no shell to parse a string CMD.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# The distroless entrypoint is already node, so only the script and flags are given here.
#
# Binding 0.0.0.0 is required for the port to be reachable from outside the container - a
# container's loopback is not the host's. That means authentication is mandatory: set
# TOROB_AUTH_TOKEN, or the server refuses to start. Pass --insecure only if you genuinely intend an
# open server.
#
# No `--port` here: platforms like Railway inject PORT, and distroless has no shell to expand
# `$PORT`. The binary reads PORT (default 3000) itself. HEALTHCHECK below assumes 3000 for local
# `docker run`; override the platform healthcheck if you set a different PORT.
CMD ["/app/dist/bin.mjs", "--http", "--host", "0.0.0.0"]

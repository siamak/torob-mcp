# torob-mcp Worker

Cloudflare Workers host for `@torob-mcp/core`. Upstream mode is **direct** (see
`docs/WORKERS_EGRESS.md`). Auth is always required.

```bash
pnpm install
npx wrangler secret put TOROB_AUTH_TOKEN   # ≥16 chars
pnpm deploy
```

- `GET /healthz` — liveness, no upstream call
- `POST /mcp` — Streamable HTTP MCP (bearer token required)

Claude Desktop remote connector URL: `https://torob-mcp.<account>.workers.dev/mcp`

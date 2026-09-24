# Deploying torob-mcp on Cloudflare Workers

Upstream mode: **direct** (see [`WORKERS_EGRESS.md`](WORKERS_EGRESS.md)). Auth is always required.

## One-click self-host

```bash
cd apps/worker
pnpm install
npx wrangler kv namespace create torob-mcp-cache   # paste id into wrangler.jsonc
openssl rand -hex 24 | npx wrangler secret put TOROB_AUTH_TOKEN
npx wrangler deploy --env=""
```

Smoke:

```bash
curl -sS https://torob-mcp.<account>.workers.dev/healthz
curl -sS -X POST https://torob-mcp.<account>.workers.dev/mcp \
  -H "authorization: Bearer $TOROB_AUTH_TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}'
```

## Bindings & secrets

| Binding / secret             | Purpose                                       |
| ---------------------------- | --------------------------------------------- |
| `CACHE_KV`                   | Long-TTL cache (price charts, shops, cities)  |
| `MCP_RATE_LIMIT`             | Edge rate limit, 60 req / 60s per token       |
| `TOROB_AUTH_TOKEN`           | Bearer token (wrangler secret, ≥16 chars)     |
| `TOROB_ALLOWED_ORIGIN_HOSTS` | Comma-separated hostnames for browser Origins |

## Claude Desktop (remote)

```json
{
  "mcpServers": {
    "torob": {
      "url": "https://torob-mcp.<account>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <TOROB_AUTH_TOKEN>"
      }
    }
  }
}
```

Fully quit and reopen Claude Desktop. Custom connector UI: same URL; if sign-in discovery fails, **Continue anyway** and set the Authorization header.

## Rotate the token

```bash
openssl rand -hex 24 | npx wrangler secret put TOROB_AUTH_TOKEN --env=""
# update Claude Desktop / clients with the new value
```

## Dashboard controls (recommended)

On the Worker route / custom domain: enable **WAF rate-limit** rules, **Bot Fight Mode**, and prefer a **custom domain** over `workers.dev` for production.

## Relay

Not used in `direct` mode. If egress starts failing, flip to `relay` per `WORKERS_EGRESS.md` and implement `apps/relay` (Phase 5.1).

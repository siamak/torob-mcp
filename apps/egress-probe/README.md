# egress-probe (throwaway)

Phase **5.0** only. Deploys a Worker that calls every Torob endpoint from
`docs/ENDPOINTS.md` and classifies the body as JSON vs challenge/HTML.

- Live: see `docs/WORKERS_EGRESS.md`
- Not part of the published `torob-mcp` package
- Delete after the direct/relay decision is recorded

```bash
pnpm install
npx wrangler deploy
curl -sS https://torob-egress-probe.<account>.workers.dev/probe | jq .
```

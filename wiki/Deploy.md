# Deploy

**Where you run it matters more than how.**

## Egress warning

Torob blocks many datacenter IP ranges. A blocked host gets an HTML challenge instead of JSON;
`torob-mcp` reports that as `Blocked` rather than hanging.

| Where | Expectation |
| --- | --- |
| Home connection in Iran | Works |
| VPS with Iranian egress | Works — recommended for production |
| Foreign VPS / AWS / GCP / Azure / Fly / Railway | Test first; often blocked |
| Cloudflare Workers | Assume blocked until proven otherwise |

**Test before you commit**, from the target host:

```bash
pnpm test:live
# or
curl -s 'https://api.torob.com/v4/base-product/search/?q=test&page=0&size=1' | head -c 120
```

JSON → fine. HTML → blocked.

## Prefer local

For almost everyone: no deploy. `claude mcp add torob -- npx -y torob-mcp` and you are done.

## Docker (short)

```bash
docker run --rm -p 127.0.0.1:3000:3000 \
  --read-only \
  -e TOROB_AUTH_TOKEN="$(openssl rand -hex 24)" \
  ghcr.io/siamak/torob-mcp:latest
```

Publish to host loopback and terminate TLS in front (Caddy/nginx). Never expose 3000 to the internet bare.

## Full recipes

Iranian VPS, Fly.io, Railway, operating notes, release checklist:
**[docs/DEPLOY.md](https://github.com/siamak/torob-mcp/blob/main/docs/DEPLOY.md)**

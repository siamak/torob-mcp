# Deploying torob-mcp

Read this first: **where you run it matters more than how.**

## The egress problem

Torob serves its JSON API to ordinary visitors without authentication, but it blocks a great many
datacenter IP ranges. A blocked server does not get a polite error — it gets an HTML challenge page
where JSON was expected, which `torob-mcp` reports as a `Blocked` error.

Observed during development (Phase 0, from a residential Iranian connection): the API answered
every request with no rate limiting, no 429s, and no authentication required. That is the
best case. From a foreign datacenter it is frequently the worst case.

| Where you run it                    | Expectation                               |
| ----------------------------------- | ----------------------------------------- |
| Home connection in Iran             | Works                                     |
| VPS with Iranian egress             | Works — the recommended production option |
| Foreign VPS (Hetzner, DO, Vultr, …) | Test it; often blocked                    |
| AWS / GCP / Azure                   | Test it; frequently blocked               |
| Fly.io / Railway / Render           | Test it; varies by region and by day      |
| Cloudflare Workers                  | Assume blocked until proven otherwise     |

**Test before you commit**, from the target host:

```bash
git clone https://github.com/siamak/torob-mcp && cd torob-mcp
pnpm install --frozen-lockfile && pnpm test:live
```

That runs sixteen live checks in about twenty seconds. If they pass, the host can reach Torob
properly — not merely get a 200 back, but get correctly filtered and sorted data.

A one-line check without cloning:

```bash
curl -s 'https://api.torob.com/v4/base-product/search/?q=test&page=0&size=1' | head -c 120
```

JSON means you are fine. HTML means you are blocked.

## Local use

No deployment needed. See the README — `claude mcp add torob -- npx -y torob-mcp` and you are done.
This is the right choice for almost everyone; the sections below matter only if you want a shared
remote server.

## Docker

The image is **`gcr.io/distroless/nodejs22-debian12:nonroot`**: no shell, no package manager, runs
as uid 65532, compatible with a read-only filesystem.

```bash
docker run --rm -p 127.0.0.1:3000:3000 \
  --read-only \
  -e TOROB_AUTH_TOKEN="$(openssl rand -hex 24)" \
  ghcr.io/siamak/torob-mcp:latest
```

The container binds `0.0.0.0` internally because a container's loopback is not reachable from the
host. That is why the token is mandatory: publish the port to `127.0.0.1` on the host as above, not
to `0.0.0.0`, unless you have a reverse proxy in front.

Verify the image signature before trusting it:

```bash
cosign verify ghcr.io/siamak/torob-mcp:latest \
  --certificate-identity-regexp 'https://github.com/siamak/torob-mcp/.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Iranian VPS — the recommended option

Any provider whose egress is inside Iran. Modest resources are plenty: the server is IO-bound and
the cache is capped at 32 MB by default.

```bash
curl -fsSL https://get.docker.com | sh

docker run -d --name torob-mcp \
  --restart unless-stopped \
  --read-only \
  -p 127.0.0.1:3000:3000 \
  -e TOROB_AUTH_TOKEN="$(openssl rand -hex 24)" \
  -e TOROB_ALLOWED_ORIGINS="https://your-client.example" \
  ghcr.io/siamak/torob-mcp:latest
```

Then terminate TLS in front of it. Caddy is two lines:

```
mcp.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Never publish port 3000 to the internet directly. The server refuses a non-loopback bind without a
token, but a reverse proxy also gives you TLS, logging and rate limiting you would otherwise have
to build.

## Fly.io

```toml
# fly.toml
app = "your-torob-mcp"
primary_region = "fra"

[build]
  image = "ghcr.io/siamak/torob-mcp:latest"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0

[[http_service.checks]]
  path = "/healthz"
  interval = "30s"
  timeout = "5s"
```

```bash
fly launch --no-deploy
fly secrets set TOROB_AUTH_TOKEN="$(openssl rand -hex 24)"
fly deploy
```

**Check egress after the first deploy**, before you wire any client to it:

```bash
fly ssh console -C "/nodejs/bin/node -e \"fetch('https://api.torob.com/v4/base-product/search/?q=test&size=1').then(r=>r.text()).then(t=>console.log(t.slice(0,80)))\""
```

`auto_stop_machines` is safe here: every tool call is request/response and the cache is expendable.

## Railway

Point a new service at this repository; Railway detects the `Dockerfile`.

- Set `TOROB_AUTH_TOKEN` in the service variables.
- Set the healthcheck path to `/healthz`.
- Railway injects `PORT`; pass it through with a custom start command if it differs from 3000:
  `node /app/bin.mjs --http --host 0.0.0.0 --port $PORT`.

Same caveat: confirm egress before relying on it.

## Cloudflare Workers

Not yet supported. Phase 5 begins with a probe Worker that measures whether Cloudflare's egress can
reach Torob at all from several colos over several days. If it cannot, the design falls back to a
minimal relay with an Iranian egress IP behind Cloudflare Tunnel. Results will be recorded in
`docs/WORKERS_EGRESS.md`.

## Operating notes

- **Logs go to stderr**, and queries are logged only at `TOROB_LOG_LEVEL=debug`. Leave it at `info`
  in production unless you are debugging, and remember that a user's searches are personal.
- **Nothing is written to disk.** No state directory, no cookie jar. Restarting loses only the
  cache.
- **Be polite upstream.** The defaults are concurrency 3 and 4 requests/second. Torob publishes no
  rate limits and returns no 429s, which means it will not tell you when you are being rude. If you
  are serving several users, raise the cache TTLs rather than the rate limit.
- **Rotate the token** by restarting with a new `TOROB_AUTH_TOKEN`; there is no session store to
  clear.
- **`/healthz` makes no upstream call**, so monitoring it cannot contribute to a block.

## Releasing (maintainer)

Publishing is **gated on a human**. The release workflow fires on a `v*` tag and will push to npm
and GHCR, so the tag is the point of no return.

Before tagging:

1. `pnpm check && pnpm test:coverage && pnpm build` — clean.
2. `pnpm inspect` — drive by hand every tool that changed. `pnpm inspect:cli` covers the mechanics
   in CI, but a human should look at the actual output of a changed tool before it ships.
3. `pnpm test:live` from a host that can reach Torob.
4. `cd apps/node && pnpm pack --pack-destination /tmp`, extract it somewhere else, install its
   dependencies, and run the binary. `apps/node/test/package.test.ts` guards this automatically now,
   because the bundle once shipped importing a private workspace package and would have broken
   every `npx torob-mcp`.
5. Docker: `docker build -t torob-mcp:rc . && docker run --rm --read-only -p 3000:3000 -e TOROB_AUTH_TOKEN=... torob-mcp:rc`
   then check `/healthz`.

Then:

```bash
npm version <patch|minor|major> --workspace torob-mcp
git push && git push --tags
```

npm publishes with provenance through GitHub OIDC trusted publishing — there is no long-lived npm
token, and publishing from a laptop is not the supported path. The image is scanned with Trivy and
signed with cosign keyless in the same workflow.

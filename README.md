# torob-mcp

**An MCP server for [torob.com](https://torob.com), Iran's price-comparison engine.**
Ask your assistant what something costs in Iran, who sells it cheapest, whether the price is good
right now, and whether the shop can be trusted.

[![CI](https://github.com/siamak/torob-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/siamak/torob-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/torob-mcp)](https://www.npmjs.com/package/torob-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[فارسی](README.fa.md)

> **Unofficial.** This project is not affiliated with, endorsed by, or connected to Torob in any
> way. It is an independent client for the undocumented JSON endpoints torob.com's own website
> uses. Those can change or stop working without notice. All prices come from Torob and are
> reported as-is.

---

## What it does

Fifteen tools covering search, prices, sellers, price history, physical shops and shop trust
signals. Prices are normalized to **Toman**. Persian, English and Finglish queries all work —
`ayfon 13` finds what you'd expect.

```
You:  What's the cheapest iPhone 13 in Iran right now, and is it a good time to buy?

→ search_torob(query: "iPhone 13")
→ product_price_chart(product_id: …)   verdict: "great" — at the 25th percentile of 12 weeks
→ product_sellers(product_id: …)       cheapest reliable seller, ★5, 300-500 orders in 90 days
```

## Install

Needs **Node 22+**.

### Claude Code

```bash
claude mcp add torob -- npx -y torob-mcp
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows:

```json
{
  "mcpServers": {
    "torob": {
      "command": "npx",
      "args": ["-y", "torob-mcp"]
    }
  }
}
```

### Cursor

`.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` globally:

```json
{
  "mcpServers": {
    "torob": {
      "command": "npx",
      "args": ["-y", "torob-mcp"]
    }
  }
}
```

### Try it without installing

```bash
npx -y torob-mcp --help
npx -y @modelcontextprotocol/inspector npx -y torob-mcp
```

## Tools

| Tool                  | What it answers                                                                   |
| --------------------- | --------------------------------------------------------------------------------- |
| `search_torob`        | "What does X cost?" — query plus category, brand, price range, condition and sort |
| `torob_suggest`       | Turns a vague, misspelled or Finglish query into phrases that work                |
| `product_details`     | Price range, seller count, specs, category path                                   |
| `product_sellers`     | Who sells it, cheapest-reliable-first, with trust signals                         |
| `product_price_chart` | ~a year of weekly prices, plus a verdict: great / fair / high                     |
| `product_variants`    | Storage, RAM and region siblings with their own prices                            |
| `similar_products`    | Torob's own "similar" list                                                        |
| `product_stores`      | Physical shops stocking it, filterable by city                                    |
| `shop_profile`        | Shop city, score, enamad trust seal, time on Torob                                |
| `browse_category`     | Browse a whole category rather than searching                                     |
| `search_filters`      | Discover category ids, brand ids and the price span                               |
| `compare_products`    | 2–5 products side by side, showing only what differs                              |
| `find_best_value`     | "Best X under Y Toman", ranked                                                    |
| `get_products_batch`  | Cards for up to 10 ids at once                                                    |
| `product_url`         | A shareable torob.com link (costs no request)                                     |

## Example prompts

- «قیمت گوشی سامسونگ A55 چنده؟» — what does the Samsung A55 cost?
- "Best wireless headphones under 2 million Toman"
- "Is 113 million Toman a good price for a used iPhone 13 Pro right now?"
- "Which shops in Shiraz have this in stock?"
- "Compare the 128GB and 256GB versions"
- "Is this seller trustworthy? They're much cheaper than everyone else."

A good habit: ask it to link the product URL, because prices move constantly.

## Remote mode

```bash
torob-mcp --http                      # 127.0.0.1:3000
torob-mcp --http --port 8080
torob-mcp --http --host 0.0.0.0       # requires TOROB_AUTH_TOKEN
```

- Binds **loopback by default**.
- A non-loopback bind **requires** `TOROB_AUTH_TOKEN` (16+ chars) unless you pass `--insecure`.
- Origin and Host are validated (DNS-rebinding protection); no wildcard CORS.
- `GET /healthz` makes no upstream call. `POST /mcp` is the transport.

## Configuration

Everything is optional and validated at startup. See [`.env.example`](.env.example).

| Variable                | Default                     | What it does                                                   |
| ----------------------- | --------------------------- | -------------------------------------------------------------- |
| `TOROB_LOG_LEVEL`       | `info`                      | Queries are logged at `debug` only, never `info`. stderr only. |
| `TOROB_USER_AGENT`      | `torob-mcp/<v> (+repo url)` | Sent on every request. Keep it honest.                         |
| `TOROB_CONCURRENCY`     | `3`                         | Simultaneous upstream requests (1–4).                          |
| `TOROB_RATE_PER_SEC`    | `4`                         | Token bucket against Torob.                                    |
| `TOROB_TTL_SEARCH_S`    | `300`                       | Search cache. Product `900`, price chart `21600`.              |
| `TOROB_AUTH_TOKEN`      | —                           | Bearer token for HTTP mode. Required on non-local binds.       |
| `TOROB_ALLOWED_ORIGINS` | —                           | Comma-separated. Empty rejects all browser Origins.            |

## Deployment

> **⚠️ Torob blocks many cloud egress IPs.** This is the single most likely reason a deployment
> fails. Cloudflare Workers and datacenter ranges (AWS, GCP, Azure, Hetzner, DigitalOcean, …) are
> frequently blocked or served a challenge page instead of JSON. The server reports this as a
> `Blocked` error rather than hanging.
>
> **An Iranian VPS, or a home connection in Iran, is the reliable option.** Test first with
> `pnpm test:live` from the target host.

Full Docker, Iranian VPS, Fly.io and Railway recipes: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Security model

Designed on the assumption that it runs on **your** machine and its output lands in an LLM's
context window. Full detail in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

- **Host allowlist.** `torob.com` and `api.torob.com` only, re-checked on **every redirect hop**.
  Product ids are validated as UUIDs before a URL is ever built.
- **Prompt-injection hygiene.** Merchant-written titles and notes are third-party text. Control
  characters, bidi overrides and zero-width characters (except ZWNJ, meaningful in Persian) are
  stripped; fields are truncated. **This reduces the risk, it does not eliminate it** — the real
  protection is that this server is entirely read-only.
- **Sponsored placements are labelled** `sponsored: true`, never hidden.
- **Shop profiles are an allowlist.** ~15 of Torob's ~72 shop fields are emitted; the rest
  (billing internals, personal contact) are dropped.
- **Supply chain.** Four runtime dependencies, lockfile committed, install scripts disabled, npm
  provenance via OIDC, Actions pinned to SHAs, CodeQL + gitleaks + Scorecard + Trivy, SBOM per
  release, cosign-signed image.

## What is sent to Torob

Only what a query needs: your **search text** (normalized), the **ids and filters** you asked for,
page and size, our User-Agent, and unavoidably your **IP address**. One exception carries a derived
`deliver_city` header: `product_stores` with a `city` argument.

**No telemetry, no analytics, no disk persistence, no cookie jar.** Full detail in
[`docs/PRIVACY.md`](docs/PRIVACY.md).

## Development

```bash
pnpm install --frozen-lockfile
pnpm check          # oxlint + oxfmt + typecheck
pnpm test           # offline and deterministic
pnpm test:live      # opt-in, hits the real API
pnpm build
pnpm inspect        # MCP Inspector, interactive
pnpm inspect:cli    # Inspector CLI checks
```

Monorepo: `packages/core` is runtime-agnostic (no `node:*`; everything injected through `Runtime`);
`apps/node` is the published package. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Docs

[Index](docs/README.md) ·
[Endpoints](docs/ENDPOINTS.md) ·
[Architecture](docs/ARCHITECTURE.md) ·
[Threat model](docs/THREAT_MODEL.md) ·
[Privacy](docs/PRIVACY.md) ·
[Deploy](docs/DEPLOY.md) ·
[Dependencies](docs/DEPENDENCIES.md) ·
[Security policy](SECURITY.md) ·
[Contributing](CONTRIBUTING.md)

## License

MIT © Siamak Mokhtari

# torob-mcp

**An MCP server for [torob.com](https://torob.com), Iran's price-comparison engine.**
Ask your assistant what something costs in Iran, who sells it cheapest, whether the price is good
right now, and whether the shop can be trusted.

[![CI](https://github.com/siamak/torob-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/siamak/torob-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/torob-mcp)](https://www.npmjs.com/package/torob-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/siamak/torob-mcp/blob/main/LICENSE)

[فارسی](https://github.com/siamak/torob-mcp/blob/main/README.fa.md) ·
[Full docs on GitHub](https://github.com/siamak/torob-mcp#docs)

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

Everything is optional and validated at startup. See
[`.env.example`](https://github.com/siamak/torob-mcp/blob/main/.env.example).

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
> fails. An Iranian VPS, or a home connection in Iran, is the reliable option. Test with
> `pnpm test:live` from the target host.

Recipes for Docker, Iranian VPS, Fly.io and Railway:
[docs/DEPLOY.md](https://github.com/siamak/torob-mcp/blob/main/docs/DEPLOY.md).

## Security & privacy

Runs on **your** machine; output lands in an LLM context window. Host allowlist
(`torob.com` / `api.torob.com` only), prompt-injection sanitization, sponsored listings labelled,
shop profiles allowlisted. **No telemetry, no cookies, no disk persistence.**

- [Threat model](https://github.com/siamak/torob-mcp/blob/main/docs/THREAT_MODEL.md)
- [Privacy](https://github.com/siamak/torob-mcp/blob/main/docs/PRIVACY.md)
- [Security policy](https://github.com/siamak/torob-mcp/blob/main/SECURITY.md)

## Docs

[Index](https://github.com/siamak/torob-mcp/blob/main/docs/README.md) ·
[Endpoints](https://github.com/siamak/torob-mcp/blob/main/docs/ENDPOINTS.md) ·
[Architecture](https://github.com/siamak/torob-mcp/blob/main/docs/ARCHITECTURE.md) ·
[Deploy](https://github.com/siamak/torob-mcp/blob/main/docs/DEPLOY.md) ·
[Contributing](https://github.com/siamak/torob-mcp/blob/main/CONTRIBUTING.md)

## License

MIT © Siamak Mokhtari

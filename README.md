# torob-mcp

**An MCP server for [torob.com](https://torob.com), Iran's price-comparison engine.**
Ask your assistant what something costs in Iran, who sells it cheapest, whether the price is good
right now, and whether the shop can be trusted.

[![CI](https://github.com/siamak/torob-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/siamak/torob-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/torob-mcp)](https://www.npmjs.com/package/torob-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> **Unofficial.** This project is not affiliated with, endorsed by, or connected to Torob in any
> way. It is an independent client for the undocumented JSON endpoints torob.com's own website
> uses. Those can change or stop working without notice. All prices come from Torob and are
> reported as-is.

[فارسی ↓](#torob-mcp-فارسی)

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
> fails. Cloudflare Workers, and datacenter ranges belonging to AWS, GCP, Azure, Hetzner, DigitalOcean
> and others, are frequently blocked or served a challenge page instead of JSON. The server reports
> this as a `Blocked` error rather than hanging.
>
> **An Iranian VPS, or a home connection in Iran, is the reliable option.** Everything else is worth
> testing before you commit to it. Run `pnpm test:live` from the target host to find out in a minute.

### Docker

The image is built on **`gcr.io/distroless/nodejs22-debian12:nonroot`** — no shell, no package
manager, runs as uid 65532, works with `--read-only`.

```bash
docker run --rm -p 3000:3000 \
  --read-only \
  -e TOROB_AUTH_TOKEN="$(openssl rand -hex 24)" \
  ghcr.io/siamak/torob-mcp:latest
```

The container binds `0.0.0.0` because a container's loopback isn't reachable from the host, so a
token is mandatory.

### Iranian VPS (recommended)

```bash
# On the VPS
curl -fsSL https://get.docker.com | sh
docker run -d --name torob-mcp --restart unless-stopped \
  --read-only -p 127.0.0.1:3000:3000 \
  -e TOROB_AUTH_TOKEN="$(openssl rand -hex 24)" \
  ghcr.io/siamak/torob-mcp:latest
```

Bind to `127.0.0.1` on the host and put nginx or Caddy in front for TLS, rather than exposing 3000
directly. Providers whose egress is inside Iran work best.

### Fly.io

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
  min_machines_running = 0

[[http_service.checks]]
  path = "/healthz"
```

```bash
fly secrets set TOROB_AUTH_TOKEN="$(openssl rand -hex 24)"
fly deploy
```

**Test egress first** — Fly's IPs may be blocked. `fly ssh console` then check `/healthz` and run
one real query.

### Railway

Point Railway at this repo; it will use the `Dockerfile`. Set `TOROB_AUTH_TOKEN` in the service
variables and add a healthcheck on `/healthz`. Same caveat: verify egress before relying on it.

### Cloudflare Workers

Not supported yet, and possibly never directly — see the egress warning above. Phase 5 begins with
a probe that decides whether a Worker can reach Torob at all, or whether it needs a relay with an
Iranian egress IP.

## Security model

Designed on the assumption that it runs on **your** machine and its output lands in an LLM's
context window. Full detail in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

- **Host allowlist.** `torob.com` and `api.torob.com` only, re-checked on **every redirect hop**.
  Product ids are validated as UUIDs before a URL is ever built — there is no path from raw input
  to a URL.
- **Prompt-injection hygiene.** Merchant-written titles and notes are third-party text. Control
  characters, bidi overrides and zero-width characters (except ZWNJ, which is meaningful in
  Persian) are stripped; fields are truncated; text is returned in labelled data fields. Every tool
  description tells the model this is third-party data. **This reduces the risk, it does not
  eliminate it** — the real protection is that this server is entirely read-only.
- **Sponsored placements are labelled** `sponsored: true`, never hidden.
- **Shop profiles are an allowlist.** Torob's shop endpoint returns 72 fields including merchant
  billing internals and personal contact details; about 15 are emitted and the rest dropped.
- **Resource limits.** Timeouts, a streamed response-size cap, bounded redirects, a byte-capped
  cache, and composite tools that refuse up front rather than fail halfway.
- **Supply chain.** Four runtime dependencies. Lockfile committed, install scripts disabled, npm
  publish with provenance via OIDC, Actions pinned to SHAs, CodeQL + gitleaks + Scorecard + Trivy,
  SBOM per release, cosign-signed image.

## What is sent to Torob

Only what a query needs: your **search text** (normalized), the **ids and filters** you asked for,
page and size, our User-Agent, and unavoidably your **IP address**. One exception carries a derived
`deliver_city` header: `product_stores` with a `city` argument, because Torob filters shops by
cookie rather than query parameter.

**No telemetry, no analytics, no disk persistence, no cookie jar.** Torob's `set-cookie` responses
are discarded on every response. The cache is in memory and dies with the process. Full detail in
[`docs/PRIVACY.md`](docs/PRIVACY.md).

## Development

```bash
pnpm install --frozen-lockfile
pnpm check          # oxlint + oxfmt + typecheck
pnpm test           # 190 tests, offline and deterministic
pnpm test:live      # opt-in, hits the real API
pnpm build
pnpm inspect        # MCP Inspector, interactive
pnpm inspect:cli    # Inspector CLI checks
```

Monorepo: `packages/core` is runtime-agnostic (no `node:*`, everything injected through a `Runtime`
interface) so the same code can run under Cloudflare Workers later; `apps/node` is the published
package. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Docs

[Endpoints](docs/ENDPOINTS.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Threat model](docs/THREAT_MODEL.md) · [Privacy](docs/PRIVACY.md) ·
[Dependencies](docs/DEPENDENCIES.md) · [Security policy](SECURITY.md)

## License

MIT © Siamak Mokhtari

---

<div dir="rtl">

# torob-mcp (فارسی)

**سرور MCP برای [ترب](https://torob.com)، موتور مقایسه قیمت ایران.**
از دستیار هوش مصنوعی‌تان بپرسید یک کالا چند است، ارزان‌ترین فروشنده کیست، الان وقت خوبی برای خرید
هست یا نه، و آیا فروشگاه قابل اعتماد است.

> **غیررسمی.** این پروژه هیچ وابستگی، تأییدیه یا ارتباطی با ترب ندارد. یک کلاینت مستقل برای همان
> endpointهای JSON است که وب‌سایت ترب خودش استفاده می‌کند. این endpointها ممکن است بدون اطلاع قبلی
> تغییر کنند یا از کار بیفتند. تمام قیمت‌ها از ترب می‌آید و همان‌طور که هست گزارش می‌شود.

## چه کاری انجام می‌دهد

پانزده ابزار برای جست‌وجو، قیمت، فروشنده‌ها، تاریخچه قیمت، فروشگاه‌های حضوری و اعتبار فروشگاه.
قیمت‌ها به **تومان** نرمال‌سازی می‌شوند. جست‌وجو با فارسی، انگلیسی و فینگلیش کار می‌کند — مثلاً
`ayfon 13` همان چیزی را پیدا می‌کند که انتظار دارید.

## نصب

به **Node 22 یا بالاتر** نیاز دارد.

**Claude Code:**

</div>

```bash
claude mcp add torob -- npx -y torob-mcp
```

<div dir="rtl">

**Claude Desktop** و **Cursor:** همان پیکربندی JSON بخش انگلیسی را استفاده کنید.

## ابزارها

| ابزار                 | کاربرد                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| `search_torob`        | جست‌وجو با فیلتر دسته، برند، بازه قیمت و مرتب‌سازی                     |
| `torob_suggest`       | تبدیل عبارت مبهم، غلط املایی یا فینگلیش به عبارت قابل جست‌وجو          |
| `product_details`     | بازه قیمت، تعداد فروشنده، مشخصات فنی، مسیر دسته‌بندی                   |
| `product_sellers`     | فروشنده‌ها به ترتیب ارزان‌ترینِ قابل‌اعتماد، همراه با نشانه‌های اعتبار |
| `product_price_chart` | حدود یک سال قیمت هفتگی و داوری اینکه قیمت فعلی خوب است یا نه           |
| `product_variants`    | نسخه‌های دیگر (حافظه، رم، ریجن) با قیمت هرکدام                         |
| `similar_products`    | فهرست «مشابه» خود ترب                                                  |
| `product_stores`      | فروشگاه‌های حضوری، با امکان فیلتر بر اساس شهر                          |
| `shop_profile`        | شهر، امتیاز، وضعیت نماد اعتماد و سابقه فروشگاه در ترب                  |
| `browse_category`     | مرور یک دسته‌بندی کامل                                                 |
| `search_filters`      | یافتن شناسه دسته‌بندی، شناسه برند و بازه قیمت                          |
| `compare_products`    | مقایسه ۲ تا ۵ محصول و نمایش فقط تفاوت‌ها                               |
| `find_best_value`     | «بهترین X زیر Y تومان»                                                 |
| `get_products_batch`  | کارت اطلاعات تا ۱۰ محصول به‌صورت یکجا                                  |
| `product_url`         | ساخت لینک قابل اشتراک ترب                                              |

## نمونه پرسش‌ها

- «قیمت گوشی سامسونگ A55 چنده؟»
- «بهترین هدفون بی‌سیم زیر ۲ میلیون تومان»
- «الان ۱۱۳ میلیون برای آیفون ۱۳ پرو کارکرده قیمت خوبیه؟»
- «کدوم فروشگاه‌های شیراز این رو موجود دارن؟»
- «این فروشنده قابل اعتماده؟ خیلی از بقیه ارزون‌تره.»

چون قیمت‌ها مدام تغییر می‌کنند، بهتر است از دستیار بخواهید لینک محصول را هم بدهد.

## هشدار مهم درباره استقرار

**ترب بسیاری از IPهای سرورهای ابری را مسدود می‌کند.** Cloudflare Workers و محدوده‌های دیتاسنتری
AWS، GCP، Azure، Hetzner و DigitalOcean اغلب مسدود می‌شوند یا به‌جای JSON صفحه چالش دریافت می‌کنند.
سرور این وضعیت را به‌صورت خطای `Blocked` گزارش می‌کند و معلق نمی‌ماند.

**یک سرور مجازی ایرانی یا اینترنت خانگی در ایران گزینه مطمئن است.** پیش از تکیه بر هر گزینه دیگری،
با اجرای `pnpm test:live` روی همان سرور آن را آزمایش کنید.

## مدل امنیتی

- فقط `torob.com` و `api.torob.com` — این فهرست در هر بار ریدایرکت دوباره بررسی می‌شود.
- متن نوشته‌شده توسط فروشنده‌ها داده شخص ثالث است: کاراکترهای کنترلی، بازنویسی جهت متن (bidi) و
  کاراکترهای بدون عرض حذف می‌شوند — به‌جز نیم‌فاصله که در فارسی معنادار است و حفظ می‌شود.
- آگهی‌های تبلیغاتی با `sponsored: true` مشخص می‌شوند و پنهان نمی‌مانند.
- **بدون تله‌متری، بدون کوکی، بدون ذخیره روی دیسک.** کش فقط در حافظه است و با بسته شدن برنامه
  از بین می‌رود.

## چه چیزی به ترب فرستاده می‌شود

فقط متن جست‌وجو (پس از نرمال‌سازی)، شناسه‌ها و فیلترهایی که خواسته‌اید، شماره صفحه، User-Agent ما،
و ناگزیر آدرس IP شما. جزئیات کامل در [`docs/PRIVACY.md`](docs/PRIVACY.md).

## مجوز

MIT © سیامک مختاری

</div>

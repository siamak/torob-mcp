# Cloudflare Workers egress gate (Phase 5.0)

**Status: day-1 samples only — decision needed.**
This gate decides whether `apps/worker` may fetch Torob **directly**, or must go through an
Iranian-egress **relay**. Do not start 5.1 / 5.2 until this file names a mode.

Probe Worker (throwaway): `https://torob-egress-probe.s-mokhtari75.workers.dev`

| Path             | Purpose                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `GET /probe`     | Hit every endpoint in `docs/ENDPOINTS.md`, return report, store in KV |
| `GET /results`   | Samples for `?day=YYYY-MM-DD` (default: today)                        |
| `GET /healthz`   | Liveness, no upstream call                                            |
| cron `0 * * * *` | Hourly self-probe (colo may be null on cron)                          |

Source: `apps/egress-probe/`. Delete the Worker and KV namespace after the mode is locked.

---

## Decision rule

| Verdict over several days / colos                 | Upstream mode                                                  |
| ------------------------------------------------- | -------------------------------------------------------------- |
| Consistently **clean** JSON (no HTML / challenge) | **`direct`** — Worker fetches Torob itself                     |
| Any recurring **challenge / HTML / block**        | **`relay`** — Worker signs requests to an Iranian-egress relay |
| Mixed / flaky                                     | Prefer **`relay`**. Do not ship direct on a maybe.             |

"Clean" means `body_kind === "json"` and HTTP status is a normal API response (typically 200),
not a Cloudflare/Torob challenge page mislabelled as success.

---

## What was probed

Eleven GETs, same hosts as production (`api.torob.com` only):

| Name          | Path                                                           |
| ------------- | -------------------------------------------------------------- |
| `search`      | `/v4/base-product/search/?q=iphone&page=0&size=1`              |
| `suggestion2` | `/suggestion2/?q=ayfon&source=next`                            |
| `details`     | `/v4/base-product/details/?prk=<fixture>`                      |
| `sellers`     | `/v4/base-product/sellers/?…&list_type=products_info`          |
| `stores`      | `/v4/base-product/sellers/?…&list_type=products_in_store_info` |
| `map_sellers` | `/v4/base-product/map/sellers/?prk=<fixture>`                  |
| `price_chart` | `/v4/base-product/price-chart/?prk=<fixture>`                  |
| `similar`     | `/v4/base-product/similar-base-product/?prk=<fixture>`         |
| `shop`        | `/v4/internet-shop/details/?id=299463`                         |
| `city_list`   | `/v4/city/list/?search=تهران&size=5`                           |
| `brand_list`  | `/v4/brand/list/?cat_list=94`                                  |

Fixture product id: `57ea65ae-0798-4cd0-96a7-38d8af180345` (from `fixtures/search.json`).
Shop id: `299463` (from `fixtures/shop_details.json`).

Each report includes: HTTP status, latency ms, `Content-Type`, body kind
(`json` / `challenge` / `html` / `empty` / `other` / `error`), challenge-marker hits,
body size, a short preview, and the Worker colo that handled the inbound request
(`request.cf.colo`). Outbound Torob traffic egresses from Cloudflare near that colo.

---

## Results — 2026-09-24 (day 1)

Local residential baseline (non-Workers, same machine as Phase 0 style checks): all sampled
endpoints returned `application/json` 200. Client edge: Cloudflare `IST` / `loc=TR`.

### Cloudflare Worker samples

| Time (UTC)           | Worker colo | Client country | Verdict   | Clean / 11 | Notes                          |
| -------------------- | ----------- | -------------- | --------- | ---------- | ------------------------------ |
| 2026-09-24T16:14:54Z | **WAW**     | TR             | **clean** | 11 / 11    | curl → workers.dev             |
| 2026-09-24T16:15:22Z | **WAW**     | TR             | **clean** | 11 / 11    | curl → workers.dev             |
| 2026-09-24T16:15:25Z | **MCI**     | US             | **clean** | 11 / 11    | independent fetch (US vantage) |
| 2026-09-24T16:16:58Z | **EWR**     | US             | **clean** | 11 / 11    | independent fetch (US East)    |

No challenge markers. No HTML bodies. Latencies from Workers were roughly 100–1300 ms per
endpoint (search / details / similar at the high end); total `/probe` wall time ≈ 5–6 s.

### Per-endpoint (representative WAW sample)

| Endpoint    | Status | Kind | Latency |
| ----------- | ------ | ---- | ------- |
| search      | 200    | json | 1207 ms |
| suggestion2 | 200    | json | 292 ms  |
| details     | 200    | json | 307 ms  |
| sellers     | 200    | json | 230 ms  |
| stores      | 200    | json | 274 ms  |
| map_sellers | 200    | json | 216 ms  |
| price_chart | 200    | json | 206 ms  |
| similar     | 200    | json | 994 ms  |
| shop        | 200    | json | 719 ms  |
| city_list   | 200    | json | 125 ms  |
| brand_list  | 200    | json | 111 ms  |

MCI (US) and EWR (US East) samples matched: **11 / 11 json**, including full `details` bodies
(~239–243 KB). Five day-1 samples are stored in the probe KV (`GET /results`).

---

## Provisional recommendation

**Lean `direct`**, based on day-1 evidence from three Cloudflare colos across EU and US
(**WAW**, **MCI**, **EWR**) — all 11/11 JSON, no challenge pages.

This is **not** yet "consistently clean over a couple of days." The hourly cron on the probe
Worker will keep writing samples to KV. Before locking the mode:

1. Re-check `GET /results` for **2026-09-25** and **2026-09-26**.
2. Hit `/probe` from at least one more region if possible (e.g. Asia colo).
3. If any sample shows `challenge` / `html` / systemic `error`, switch the decision to **`relay`**
   and proceed with 5.1. Do not treat a single flaky hour as noise if it repeats.

| Mode       | Meaning for Phase 5                                                                        |
| ---------- | ------------------------------------------------------------------------------------------ |
| **direct** | Skip 5.1. Implement 5.2 Worker with `Runtime.fetch` → Torob. Keep relay design in reserve. |
| **relay**  | Build `apps/relay` (5.1) on Iranian egress + Tunnel, then Worker signed fetch (5.2).       |

**Decision (fill in):** `_pending — awaiting 48h more samples / maintainer call_`

---

## How to keep collecting

```bash
cd apps/egress-probe
pnpm deploy          # already deployed; only if you change the probe
curl -sS 'https://torob-egress-probe.s-mokhtari75.workers.dev/probe' | jq '{verdict,worker_colo,clean_count,blocked_count}'
curl -sS 'https://torob-egress-probe.s-mokhtari75.workers.dev/results' | jq '{count, colos: [.samples[].worker_colo]}'
```

Paste new day tables above. When finished:

```bash
cd apps/egress-probe && npx wrangler delete
npx wrangler kv namespace delete --namespace-id d5e364fc5fe440e585d210b11e2610da
```

---

## Relation to the README warning

The top-level README still warns that Cloudflare Workers **may** be blocked. Day-1 data says
they are **not** blocked from WAW and MCI right now. That warning stays until this gate is
closed; if we lock `direct`, rephrase it to "was blocked historically / may return; staging
smoke tests watch for `Blocked`."

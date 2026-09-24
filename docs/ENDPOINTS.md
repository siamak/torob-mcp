# Torob endpoint recon (Phase 0)

Recon date: **2026-09-24**. Probed from a residential **IR** egress with plain `curl`.
Nothing here is an official or documented API — these are the private JSON endpoints
`torob.com`'s Next.js web app calls. They can change without notice; every one of them
is pinned by a fixture in `fixtures/` and must be re-verified when a contract test fails.

**Hosts in use:** `api.torob.com` (all JSON), `torob.com` (canonical product/shop URLs only).
Those two are the entire allowlist. `image.torob.com`, `storage3.torob.com` and
`assets.torob.com` appear inside responses and are **never fetched** — image URLs are dropped
before output.

---

## 0. Global facts

| Fact                 | Detail                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth**             | None. No API key, no cookie, no `Authorization` header needed on any endpoint below.                                                                                                                                                                                                                                    |
| **Required headers** | **None.** Every endpoint answered a bare `curl` with no `User-Agent`, `Referer`, `Origin`, or `Accept`. We will still send an honest UA with a project URL.                                                                                                                                                             |
| **Method**           | `GET` only (`allow: GET, HEAD, OPTIONS`).                                                                                                                                                                                                                                                                               |
| **Protocol**         | HTTP/2, `content-type: application/json`, `content-language: fa`.                                                                                                                                                                                                                                                       |
| **Front door**       | `server: Torob`. No Cloudflare/WAF challenge observed on `api.torob.com`.                                                                                                                                                                                                                                               |
| **Caching**          | Upstream sends `cache-control: no-store, must-revalidate, private`. We cache client-side anyway (TTLs in the brief); nothing upstream forbids it beyond politeness.                                                                                                                                                     |
| **Price unit**       | **Toman.** Verified: `price: 113000000` ↔ `price_text: "از ۱۱۳٫۰۰۰٫۰۰۰ تومان"` on both the card and the seller row. `shop.price_unit_str: "ir_toman"` confirms the merchant side. **No Rial conversion is needed — but never assume; the contract test asserts `price` against the digits parsed out of `price_text`.** |
| **Numbers**          | `price` is an integer on cards/sellers, but `min_price`/`max_price` on search come back as **floats** (`18000.0`). Schema must accept both and normalize.                                                                                                                                                               |
| **Digits in text**   | All human-readable strings use Persian digits (`۱۱۳٫۰۰۰٫۰۰۰`) and Jalali dates. Only the numeric fields are ASCII.                                                                                                                                                                                                      |
| **Geo-blocking**     | **None observed from IR.** Not yet tested from a foreign or cloud egress — that is the Phase 5.0 gate (`docs/WORKERS_EGRESS.md`). Assume cloud IPs may be blocked until proven otherwise.                                                                                                                               |
| **Rate limits**      | No `429` and no rate-limit headers seen. 20 concurrent search requests all returned `200`. There is no observable ceiling, which makes politeness **our** responsibility, not theirs: concurrency ≤ 4 + token bucket + jittered backoff, per the brief.                                                                 |
| **Cookies**          | Responses `set-cookie` freely (`search_session`, `deliver_city=392`, `is_torob_user_logged_in`). **We discard every one.** See the `deliver_city` gotcha in §8.                                                                                                                                                         |

### Silent-parameter hazard (applies to every endpoint)

Unknown query parameters are **ignored without error**, and so are some _known-looking_ ones.
Confirmed:

- `brands=14` → ignored (full unfiltered result). The real name is **`brand=14`**.
- `limit=3` on `similar-base-product` → ignored (returned 26).
- `page` / `size` on `base-product/sellers` → ignored (returned all 69).
- `name=` / `q=` on `city/list` → ignored. The real name is **`search=`**.

There is no error to catch, so a wrong parameter name silently degrades into "no filter applied".
**Every filter we ship must have a client test that proves the filter actually narrowed the result set**, not just that the call returned 200.

---

## 1. `search_torob`, `browse_category`, `find_best_value`, `search_filters`

```
GET https://api.torob.com/v4/base-product/search/
```

Fixtures: `fixtures/search.json` (`q=iphone`), `fixtures/search_category.json` (category + brand + price + sort).

One endpoint serves all four tools. `browse_category` is just this call with `category=` and no `q=`
(that is exactly what the `/browse/<id>/<slug>/` page does server-side). `find_best_value` is this
call with `price__lt=<budget>` plus our own ranking. `search_filters` reads the `filters1` /
`filters2` / `attributes` / `categories` blocks off any response.

### Params

| Param                    | Type        | Notes                                                                                                                                                                                                                                                        |
| ------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `q`                      | string      | Free text. Omit for pure category browse. Persian, Finglish and misspellings all work.                                                                                                                                                                       |
| `category`               | int         | Category id, e.g. `94`. **Singular.**                                                                                                                                                                                                                        |
| `brand`                  | int         | Brand id, e.g. `14`. **Singular — `brands` is silently ignored.**                                                                                                                                                                                            |
| `price__gt`, `price__lt` | int (Toman) | Inclusive-ish bounds. Verified: `20000000`–`30000000` on cat 94 cut `count` 1200 → 193.                                                                                                                                                                      |
| `sort`                   | enum        | `""` popularity (default) · `price` cheapest · `-price` priciest · `-date` newest · `-supply` most sellers. Source: `filters2[slug=sort]`.                                                                                                                   |
| `page`                   | int         | **0-indexed.** Verified non-overlapping across pages 0/1/2.                                                                                                                                                                                                  |
| `size`                   | int         | Verified working at 5/10/24/50/**100**. Web uses 24. We cap at 50.                                                                                                                                                                                           |
| `available`              | bool        | `true` = in-stock only.                                                                                                                                                                                                                                      |
| `stock_status`           | enum        | `new` · `stock` (used/کارکرده).                                                                                                                                                                                                                              |
| `shop_type`              | enum        | `offline` = only products with a physical seller.                                                                                                                                                                                                            |
| `torobpay`               | bool        | Installment-capable sellers.                                                                                                                                                                                                                                 |
| Attribute facets         | string      | Per-category slugs from `attributes[]`: `storage`, `ram`, `screen_size`, `battery`, `network`, `sim_card`, `rom_country`, `register_status`, … Values come from that same block. Out of scope for v1 tools; documented so `search_filters` can surface them. |

### Pagination

`page` is 0-indexed; `next` holds a fully-formed URL **laced with tracking params**
(`suid`, `init_suid`, `rank_offset`, `_bt__experiment`). **Never follow `next` verbatim** — it would
propagate a session id. Our cursor stores `{q, filters, page, size}` and we rebuild the URL.
`count` appears to cap at **1200** for broad category browses (cat 94 reported 1200 both filtered and
unfiltered on the default sort) — treat `count` as an estimate, not a total.

### Field map (card → our output)

| Upstream                                                            | Ours               | Note                                                                         |
| ------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `random_key`                                                        | `product_id`       | UUID v4. This is the `prk` everywhere else.                                  |
| `name1`                                                             | `title_fa`         | Untrusted third-party text → `sanitize.ts`.                                  |
| `name2`                                                             | `title_en`         | Same. Often empty.                                                           |
| `price`                                                             | `price_toman`      | int, Toman, `0` means "no price".                                            |
| `price_prefix`                                                      | —                  | `"cheapest"` — encoded in our field naming instead.                          |
| `price_text`                                                        | —                  | Persian-digit string; **used only by the contract test** to assert the unit. |
| `shop_text`                                                         | `shop_count`       | `"در ۱۱ فروشگاه"` → parse the Persian digits to `11`.                        |
| `stock_status`                                                      | `condition`        | `"کارکرده"` / `"نو"`.                                                        |
| `web_client_absolute_url`                                           | `url`              | Relative; prefix `https://torob.com`.                                        |
| `is_adv`                                                            | `is_ad`            | Sponsored placement — surface it, don't hide it.                             |
| `badges[].text`                                                     | `badges[]`         | Sanitize + truncate.                                                         |
| `has_nearby_shop`                                                   | `has_local_seller` |                                                                              |
| `is_authentic`                                                      | `is_authentic`     |                                                                              |
| `discount_info`                                                     | `discount`         | Usually `[]`.                                                                |
| `more_info_url`, `similar_api`, `media_search`                      | **dropped**        | Contain `suid`/`search_id`/experiment ids.                                   |
| `media_urls`, `image_url`, `image_count`                            | **dropped**        | Image blobs, per the brief.                                                  |
| `card_type`, `name1_max_lines`, `price_text_mode`, `estimated_sell` | **dropped**        | Layout hints.                                                                |

### Response-level fields

`count` · `min_price` / `max_price` (**the span of the _unfiltered_ query — they do not move when
`price__gt`/`price__lt` are applied**, verified) · `spellcheck {is_spellchecked, initial_query, corrected_query}` ·
`categories[] {title, cat_id}` · `parent_categories[]` · `category_is_leaf` ·
`filters1[]` (price range + brand list) · `filters2[]` (sort/toggles) · `attributes[]` (per-category facets) ·
`related_queries` (often `null`).

**Gotcha:** `available_filters` is `[]` on a non-leaf query — the usable facets live in
`filters1`/`filters2`/`attributes`, which are populated in both cases.

---

## 2. `torob_suggest`

```
GET https://api.torob.com/suggestion2/?q=<text>&source=next
```

Fixture: `fixtures/suggestion2.json`. **Note the path has no `/v4` prefix** — it hangs off the API root.
(`/v4/suggestion2/` is a 404.) Found in the web bundle as `` `${api_name}/suggestion2/?q=${e}&source=${s}` ``.

Returns a bare **array**: `[{ "text": "ayfon 13", "is_history": false }, …]` (8 items for our probe).

`q=ayfon` returned Finglish completions, so Torob's own autocomplete already handles
transliteration. `torob_suggest` should therefore combine **two** sources:

1. this endpoint's completions, and
2. `spellcheck.corrected_query` from a cheap `search?size=1` call, which is what catches real misspellings.

That makes it a **2-subrequest** tool — relevant to the Workers budget.

---

## 3. `product_details`, `product_variants`, `product_url`, `compare_products`, `get_products_batch`

```
GET https://api.torob.com/v4/base-product/details/?prk=<uuid>
```

Fixture: `fixtures/product_details.json`.

**This is the heavy one: ~247 KB raw.** It is also the only per-product endpoint — there is no
lightweight "card by id" route (probed `card`, `info`, `summary`, `base`, `mini`, `details-lite`,
`base-product-card` → all 404). So:

- `get_products_batch` (≤10) and `compare_products` (2–5) are **N sequential `details` calls**.
  Passing `prk` twice returns only the **last** one — there is no batch form.
  Budget: `n` subrequests, declared up front, cache-first.
- Because of the size, the client must cap response bytes generously (≥4 MB) yet the tool must
  project hard down to a compact shape.

### What it carries (one call answers four tools)

| Block                                                                                                                  | Feeds                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `min_price`, `max_price`, `shop_text`, `name1/name2`, `key_specs`, `structural_specs`, `breadcrumbs`, `torob_category` | `product_details`                                                                                                               |
| `variants[] {title, items[<card>]}`                                                                                    | `product_variants` — e.g. `"حافظه و رم"` with a card per sibling, each with its own cheapest `price`. **No extra call needed.** |
| `products_info {result[], count, tab_title}`                                                                           | first page of `product_sellers` (embedded, ~69 rows)                                                                            |
| `products_in_store_info {result[], count}`                                                                             | first page of `product_stores`                                                                                                  |
| `web_client_absolute_url`, `slug_name`, `name1`                                                                        | `product_url`                                                                                                                   |

`product_url` does **not** need this call at all: `https://torob.com/p/<prk>/` returns a **301** to the
canonical slug URL. We can synthesise the URL from a validated UUID with **zero** upstream requests, and
only call `details` when the caller also wants the title.

### Fields to drop

`buy_box_*` / `new_buy_box_*` (redirect URLs carrying `session_id`, `bvid`, `device_id`),
`more_info_url`, `similar_api`, `similar_listing`, `similar_products`, `media_search`,
`interview_survey_data`, `image_urls`, `media_urls`, `no_index`, `*_max_lines`, `price_text_mode`.

### Category path

`breadcrumbs[] {id, title, cat_id, brand_id, url}` — first entry is the root `ترب` with `cat_id: 0`
(drop it); the final entry may be a **brand**, not a category (`brand_id: 14`). `torob_category` holds
the leaf id (`94`).

---

## 4. `product_sellers`

```
GET https://api.torob.com/v4/base-product/sellers/?prk=<uuid>&list_type=products_info
```

Fixture: `fixtures/product_sellers.json`.

**Not paginated.** `page` and `size` are accepted and ignored — the call returns **every** seller
(69 rows, ~165 KB) with `{results, count}` and no `next`. Pagination is therefore **entirely ours**:
fetch once, cache, slice by cursor.

Rows arrive already **cheapest-first**, so "cheapest-reliable-first" is a re-rank we do locally over
`price` + `shop_score` + `score_info` + `availability`.

### Field map

| Upstream                                                                              | Ours                                                                                                        |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `shop_name`, `shop_name2`                                                             | `shop_name` (untrusted), `shop_city`                                                                        |
| `shop_id`                                                                             | `shop_id` → feeds `shop_profile`                                                                            |
| `price`                                                                               | `price_toman`                                                                                               |
| `is_price_unreliable`                                                                 | `price_unreliable` — **surface this**, it flags bait pricing                                                |
| `availability`                                                                        | `in_stock`                                                                                                  |
| `shop_score` (0–5), `shop_score_percentile`, `shop_votes_count`                       | `trust.*`                                                                                                   |
| `score_info {score, score_text, complaints_info{title, summary[]}}`                   | `trust.summary[]` — Persian sentences, e.g. "حدود ۳۰۰ تا ۵۰۰ سفارش در ۹۰ روز اخیر". Sanitize + truncate.    |
| `last_price_change_date`                                                              | `price_updated` — relative Persian ("۶ ساعت پیش"). Keep as a string; it is not a timestamp.                 |
| `guarantee_info.status`                                                               | `torob_warranty` (`enabled`/`disabled`)                                                                     |
| `installment`, `is_filtered_by_bnpl`, `is_filtered_by_torobpay`                       | `installment_available`                                                                                     |
| `more_info {free_shipping, payment_on_delivery, same_day_delivery, shipping_types[]}` | `shipping`                                                                                                  |
| `has_public_torob_profile`                                                            | gates whether we offer `shop_profile` as the next call                                                      |
| `page_url`                                                                            | **dropped** — redirect URL with `session_id`/`bvid`                                                         |
| `name1`, `name2`                                                                      | `listing_title`, `listing_note` — **the most injection-prone strings in the whole API** (merchant-authored) |

`list_type` is the switch: `products_info` (online) · `products_in_store_info` (physical) ·
`products_instore_info` (a third, empty, `is_visible: false` list — ignore).

---

## 5. `product_stores`

```
GET https://api.torob.com/v4/base-product/sellers/?prk=<uuid>&list_type=products_in_store_info
GET https://api.torob.com/v4/base-product/map/sellers/?prk=<uuid>      # adds `location`
```

Fixtures: `fixtures/product_stores.json`, `fixtures/map_sellers.json`.

Same endpoint as §4 with the other `list_type`; also unpaginated (22 rows). Adds
`working_hours {type, title{status,text}, schedule[7]}`, `is_open`, `distance`, `supports_fast_delivery`,
`shop_badge`, `purchasing_terms`. The `map/sellers/` variant returns the same rows plus a `location`
object — only worth calling if we ever expose coordinates; v1 should not.

### The city filter (important)

`cities=`, `city=` as query params are **ignored**. City filtering is driven by the
**`deliver_city` cookie**, which the API sets itself (defaulting to `392` = Tehran):

```
curl -H 'Cookie: deliver_city=712' …list_type=products_in_store_info   # 22 rows → 2 rows, both لار
```

So `product_stores(city)` has two possible implementations, and this is a **Phase 1 decision I need
your call on**:

- **(a) Client-side filter** on `shop_name2`. Zero cookies, but wrong: it filters only the 22 rows the
  Tehran-default server chose to return, so a shop in a small city can be invisible.
- **(b) Send a single derived request header** `Cookie: deliver_city=<validated int>`, with **no cookie
  jar, no persistence, and nothing stored between calls** — the value is computed from the tool's own
  `city` argument, never from a `set-cookie`. Correct results; the brief's "no cookies" rule is about
  not carrying _Torob's_ state, which this does not do.

**My recommendation: (b)**, documented explicitly in `docs/PRIVACY.md` as the one and only header we
derive. Resolve the name → id via `GET /v4/city/list/?search=<name>` (fixture `city_list.json`;
`search=` is the working param, `size=100` works, `id 392` Tehran, `id 712` لار). Also
`GET /v4/city/most-visited/list/` returns the top 5 cities for a cheap default.

---

## 6. `product_price_chart`

```
GET https://api.torob.com/v4/base-product/price-chart/?prk=<uuid>
```

Fixture: `fixtures/price_chart.json` (~7 KB — small enough to keep whole).

```jsonc
{ "labels": ["۴ آبان ۱۴۰۰", …],                       // 52 Jalali date strings, Persian digits
  "dataSets": [ { "label": "میانگین قیمت", "entries": [{ "val": 43500000, "i": 0 }, …] },
                { "label": "کمترین قیمت",  "entries": […] } ] }
```

Exactly the shape the brief wants: **52 points ≈ weekly over a year**, with both **average**
(`میانگین قیمت`) and **minimum** (`کمترین قیمت`) series. `entries[].i` indexes into `labels`, and
series are **sparse** — never zip by position, always join on `i`.

Labels are Jalali with Persian digits and **irregular spacing** (the first points span 2021→2022).
Plan: parse `"۴ آبان ۱۴۰۰"` → `{jy, jm, jd}` → ISO via a tiny in-repo Jalali converter (~30 lines,
no dependency) and emit both. The "good price / bad price" verdict is computed locally:
current `min_price` vs the min series' recent percentile.

---

## 7. `similar_products`

```
GET https://api.torob.com/v4/base-product/similar-base-product/?prk=<uuid>
```

Fixture: `fixtures/similar_products.json`. Returns `{results[<card>], count, next, previous}` — the
same card shape as search (§1). **`limit` is ignored** (asked for 3, got 26), so we slice locally.

`/v4/base-product/similar-listings/?prk=…` also exists but returned `{"results": [], "title": "آگهی‌های مرتبط"}`
— classified-ad cross-sell, empty for our probe. Not worth a tool.

---

## 8. `shop_profile`

```
GET https://api.torob.com/v4/internet-shop/details/?id=<shop_id>
```

Fixture: `fixtures/shop_details.json`.

**The parameter is `id`, not `shop_id`** — `?shop_id=` returns `400 {"error":{"message":"شناسه‌ی فروشگاه معتبر نیست."}}`.
This was not in the web bundle; it was found by probing after the shop page turned out to be
`getInitialProps`-rendered. **No HTML parsing and no cheerio are needed anywhere in this project.**

### ⚠️ This endpoint over-shares — strict allowlist required

72 fields come back, including the merchant's **billing and CRM internals** and **contact PII**:
`billing_info`, `credit`, `click_price`, `daily_budget`, `payment_model`, `users: [13682359]`,
`search_vector`, `custom_search_score`, `reports_ticket_id`, `bid_force_deactivation`, plus
`customer_support_info.emails[]` (a personal Gmail address), `phone`, `second_phone` and a full
street `address`.

Output must be an **allowlist, never a denylist**. Ship only:
`id` · `name` · `city` · `province` · `shop_type` (`online-offline`) · `shop_score` (0–5) ·
`score_info[]` (the Persian trust sentences) · `enamad_level` / `enamad_expire_date` / `licenses[]`
(the نماد اعتماد trust seal — `block_description: "فعال"` / `block_status: "active"` is the liveness flag) ·
`active_time` ("۱۰ ماه و ۱ هفته" — directly answers "how long on Torob") · `date_added` ·
`last_updated` · `domain` · `upvotes` / `downvotes` / `score_percentile` · `is_marketplace` ·
`additional_infos[]`, `payment_info`, `delivery_info` (sanitized, truncated).

Everything else is dropped. The committed fixture is already scrubbed of all of it.

Related: `GET /v4/brand/list/?cat_list=<cat_id>` → a bare array of `{id, slug, name1, name2}` (51 brands
for cat 94). Useful to `search_filters` when a response's `filters1` is thin.

---

## 9. Error model

Fixture: `fixtures/errors.json`. **Everything is an HTTP 404 with a different body shape each time.**

| Case                        | Status | Body                                                            | Maps to     |
| --------------------------- | ------ | --------------------------------------------------------------- | ----------- |
| Unknown but well-formed prk | `404`  | `{"message":"Base product not found: <uuid>"}`                  | `NotFound`  |
| **Malformed prk**           | `404`  | `{"random_key":"not-a-uuid"}`                                   | — see below |
| Missing `prk`               | `404`  | `{"error":{"message":"اطلاعات محصول درخواست شده وجود ندارد."}}` | `NotFound`  |
| Bad shop id                 | `400`  | `{"error":{"message":"شناسه‌ی فروشگاه معتبر نیست."}}`           | `NotFound`  |
| Unknown path                | `404`  | `{"error":{"message":"صفحه‌ی مورد نظر پیدا نشد."}}`             | `Upstream`  |

The malformed-id case is the nastiest: a **200-shaped body echoed back under a 404**. It would sail
straight through a naive "`res.ok` ? parse : throw" and, if we ever parsed the body on a 404,
`{"random_key": …}` would partially satisfy a product schema. Two defences: **(1)** reject ids against
a strict UUID-v4 zod pattern before building the URL, so this request is never made; **(2)** branch on
status _before_ parsing, and parse error bodies with a dedicated union of the three shapes above,
falling back to `Upstream` rather than `SchemaDrift` when none matches.

Nothing upstream distinguishes rate-limiting or blocking today, so `RateLimited` / `Blocked` will be
inferred client-side: `429`/`503` → `RateLimited`; an HTML body where JSON was expected, or a
Cloudflare/challenge marker → `Blocked` (this is the shape we expect the Phase 5.0 probe to hit).

---

## 10. Tool → endpoint coverage

| Tool                  | Endpoint(s)                                                                        | Subrequests | Notes                                      |
| --------------------- | ---------------------------------------------------------------------------------- | ----------- | ------------------------------------------ |
| `search_torob`        | `search/`                                                                          | 1           |                                            |
| `torob_suggest`       | `suggestion2/` + `search/?size=1`                                                  | 2           | second call only for `spellcheck`          |
| `product_details`     | `details/`                                                                         | 1           |                                            |
| `product_sellers`     | `sellers/?list_type=products_info`                                                 | 1           | unpaginated upstream; our cursor           |
| `product_price_chart` | `price-chart/`                                                                     | 1           | + local verdict                            |
| `product_variants`    | `details/`                                                                         | 1           | `variants[]`, shares the details cache     |
| `similar_products`    | `similar-base-product/`                                                            | 1           | slice locally                              |
| `product_stores`      | `sellers/?list_type=products_in_store_info` (+ `city/list/` when `city` is a name) | 1–2         | city via derived header, pending your call |
| `shop_profile`        | `internet-shop/details/?id=`                                                       | 1           | strict output allowlist                    |
| `browse_category`     | `search/?category=`                                                                | 1           |                                            |
| `search_filters`      | `search/?size=1` (+ `brand/list/`)                                                 | 1–2         |                                            |
| `compare_products`    | `details/` × n                                                                     | 2–5         | budget declared up front                   |
| `find_best_value`     | `search/` (+ `price__lt`)                                                          | 1           | ranking is local                           |
| `get_products_batch`  | `details/` × n                                                                     | ≤10         | no batch form exists                       |
| `product_url`         | none (301 pattern)                                                                 | **0**       | `details/` only if the title is wanted     |

Every capability in the brief is covered by a JSON endpoint. **No HTML scraping is required**, so
cheerio will not be a dependency.

---

## 11. Open items for Phase 1

1. **`deliver_city` header** for `product_stores` — option (b) above. Needs your yes/no.
2. **Jalali → ISO** conversion for `price_chart` labels: tiny in-repo converter vs. a dependency
   (`jalaali-js`, ~2 KB, zero deps). I lean in-repo to keep `packages/core` dependency-free.
3. **Persian-digit parsing** of `shop_text` ("در ۱۱ فروشگاه") and `price_text` — lands in `lib/fa.ts`
   alongside the normalizer, and the `price_text` parse doubles as the unit assertion in contract tests.
4. **`count` caps at 1200** on broad browses — decide whether to report it as `approx_total`.
5. **Foreign/cloud egress is untested.** Phase 5.0 gate stands as written.

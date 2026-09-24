# Privacy

What this server sends, stores, and tells anyone. Short version: it talks to Torob and to nobody
else, and it keeps nothing.

## What reaches Torob

Only what a tool call needs, to `api.torob.com` or `torob.com` over HTTPS:

| Sent                               | Example                                                               | When                                                                 |
| ---------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Your search text                   | `q=گوشی سامسونگ`                                                      | `search_torob`, `torob_suggest`, `find_best_value`, `search_filters` |
| Product, shop, category, brand ids | `prk=57ea65ae-…`, `id=299463`                                         | the id-based tools                                                   |
| Filters you asked for              | `price__gt`, `price__lt`, `sort`, `brand`, `category`, `stock_status` | as applicable                                                        |
| Page and size                      | `page=0&size=20`                                                      | list tools                                                           |
| Our User-Agent                     | `torob-mcp/0.1.0 (+https://github.com/siamak/torob-mcp)`              | every request                                                        |
| A derived `deliver_city` header    | `Cookie: deliver_city=712`                                            | **only** `product_stores` with a `city` argument                     |
| Your IP address                    | —                                                                     | unavoidably, as with any HTTP request                                |

Search text is **normalized first** (`lib/fa.ts`): Arabic letter forms unified, Persian digits
converted to ASCII, whitespace collapsed. What Torob sees is a cleaned-up version of what you typed.

### About that one header

Torob filters physical shops by city through a `deliver_city` cookie, not a query parameter — the
parameters that look like they should work are silently ignored (`docs/ENDPOINTS.md` §5). So
`product_stores({city})` resolves the name to an id and sends that one header.

It is a request parameter that upstream happens to spell as a cookie. Specifically:

- The value is computed from **your tool argument**, never from anything Torob sent us.
- There is **no cookie jar**. Every `set-cookie` Torob returns is discarded on every response, so we
  never carry a session it could correlate.
- Nothing is stored between calls.
- No other request sends it. Without a `city` argument, no cookie header is sent at all.

## What this server never sends

- No telemetry, analytics, crash reporting, or "anonymous usage statistics". There is no endpoint
  for it, because there is no code for it.
- Nothing to any host but `torob.com` and `api.torob.com`. That allowlist is hardcoded and
  re-checked on every redirect hop; an off-allowlist redirect is refused, not followed.
- No Torob account credentials. This server never authenticates to Torob and never will — the
  account-scoped endpoints (`/v4/user/*`) are deliberately out of scope.
- Your queries are never sent to the project maintainers, and there is no way for us to see them.

## What is stored

| Where         | What                                                                                       | How long                                              |
| ------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Memory        | Responses from Torob, keyed by a SHA-256 digest of your normalized arguments               | 5 min to 24 h by TTL, and gone when the process exits |
| Disk          | **Nothing**                                                                                | —                                                     |
| Logs (stderr) | Tool name, duration, error kind. **Queries only at `debug`**, never at the default `info`. | Wherever your MCP client sends stderr                 |

The cache is in memory and dies with the process. No database, no cache directory, no cookie file,
no `~/.torob-mcp`.

## What the LLM sees

Tool results are compact JSON: prices, ids, shop names, trust signals. Merchant-authored text
(titles, listing notes) is sanitized first — control characters, bidi overrides and zero-width
characters are stripped, fields are truncated — and returned in clearly labelled data fields.
Image URLs, tracking URLs and upstream session identifiers are dropped rather than forwarded.

`shop_profile` is a strict allowlist. Torob's shop endpoint returns 72 fields including the
merchant's billing internals and personal contact details; about 15 are emitted and everything else
is dropped, so a field Torob adds later is invisible by default rather than leaking.

## If you run the HTTP transport

You become the operator of a service other people can reach, and their queries pass through your
machine to Torob under your IP. Bind loopback unless you mean otherwise, require a token, and see
[`docs/THREAT_MODEL.md`](THREAT_MODEL.md).

## Torob's own privacy practices

Are Torob's. This project is unofficial and unaffiliated, and it cannot make any commitment on
their behalf.

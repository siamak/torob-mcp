# Privacy

Short version: this server talks to Torob and to nobody else, and it keeps nothing.

## What reaches Torob

- Your **search text** (normalized)
- Product / shop / category / brand **ids** and filters you asked for
- Page and size
- Our User-Agent
- Your **IP** (unavoidable)
- One special case: a derived `deliver_city` header on `product_stores` when you pass `city`

## What never happens

- No telemetry or analytics
- No disk persistence, no cookie jar (every Torob `set-cookie` is discarded)
- No Torob account login
- Queries are never sent to the maintainers

## Full detail

**[docs/PRIVACY.md](https://github.com/siamak/torob-mcp/blob/main/docs/PRIVACY.md)** ·
[Threat model](https://github.com/siamak/torob-mcp/blob/main/docs/THREAT_MODEL.md) ·
[Security policy](https://github.com/siamak/torob-mcp/blob/main/SECURITY.md)

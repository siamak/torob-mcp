# Contributing

Thanks for helping. A few rules are non-negotiable because this is an unofficial client for a private API.

## Setup

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm inspect
```

Node 22+ and pnpm. `pnpm test` is offline; `pnpm test:live` is opt-in.

## Hard rules (summary)

- Only `packages/core/src/torob/client.ts` may call `runtime.fetch`
- `packages/core` stays runtime-agnostic (no `node:*`, no `process`)
- Every external response through zod; all third-party text through `sanitize.ts`
- Never write invisible characters literally into source
- No new runtime dependency without a note in `docs/DEPENDENCIES.md`
- Filter tests must prove the result set **narrowed** — Torob ignores unknown params with 200

## Changing an endpoint

Update together: `docs/ENDPOINTS.md` + fixture + zod schema.

## Full guide

**[CONTRIBUTING.md](https://github.com/siamak/torob-mcp/blob/main/CONTRIBUTING.md)**

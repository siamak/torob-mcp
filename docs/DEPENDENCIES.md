# Dependencies

Every runtime dependency is a permanent liability: it runs on other people's machines, inside a
process that talks to the network and feeds an LLM. This file exists so adding one is a decision,
not a reflex. **A new runtime dependency needs an entry here and a review.**

## Runtime

### `packages/core` — two, both unavoidable

| Package                     | Why                                                                                                                                      | What replacing it would cost                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `zod`                       | Every external response is parsed through a schema; this is the schema-drift alarm and the reason no `any` or `as` touches network data. | Hand-written validators for ~12 response shapes, which is exactly the code most likely to be wrong and least likely to be reviewed. |
| `@modelcontextprotocol/sdk` | The protocol itself.                                                                                                                     | Implementing MCP from scratch.                                                                                                      |

Core deliberately has nothing else. It uses `fetch`, `URL`, `URLSearchParams`, `TextEncoder`,
`crypto.subtle` and `btoa` — all web standards, which is what lets the same code run under Node and
workerd.

### `apps/node` — two more, isolated from core

| Package     | Why                                                                                                          | Notes                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `pino`      | Structured logging to stderr. stdout belongs to the stdio transport, so the destination is fixed at fd 2.    | Never imported by core; core logs through `Runtime.log`.     |
| `lru-cache` | Byte-capped in-memory cache. Capped in bytes rather than entries because one `details/` response is ~247 KB. | Never imported by core; core caches through `Runtime.cache`. |

`undici` is not a dependency: Node 22's global `fetch` is undici already.

## What we deliberately do not depend on

| Not used                                          | Why not                                                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cheerio`, `jsdom`, any HTML parser               | Phase 0 found a JSON endpoint for every capability, including shop profiles, which looked like it would need HTML. See `docs/ENDPOINTS.md`.                                                                                           |
| `jalaali-js`, `date-fns-jalali`, `moment-jalaali` | The Jalali→Gregorian conversion is closed-form integer arithmetic, about 40 lines in `lib/fa.ts`. It is a **devDependency** instead, used as the oracle in a property test — so we get the correctness guarantee without shipping it. |
| `axios`, `node-fetch`, `got`                      | `fetch` is built in and is what the injected `Runtime.fetch` expects.                                                                                                                                                                 |
| `lodash`, `ramda`                                 | Nothing here needs them.                                                                                                                                                                                                              |
| A rate-limiter library                            | The token bucket is ~40 lines and has to be swappable per runtime anyway (Workers uses its own binding).                                                                                                                              |
| A telemetry SDK                                   | There is no telemetry, by policy. See `docs/PRIVACY.md`.                                                                                                                                                                              |

## Dev dependencies

`typescript`, `vitest`, `@vitest/coverage-v8`, `fast-check`, `jalaali-js` (test oracle), `oxlint`,
`oxfmt`, `tsdown`, `@types/node`. None of these ship.

## Supply-chain posture

- Lockfile committed; CI installs `--frozen-lockfile --ignore-scripts`.
- Install scripts are disabled repo-wide through pnpm's `onlyBuiltDependencies` allowlist, which is
  empty.
- Published to npm with **provenance via GitHub OIDC trusted publishing** — no long-lived npm token
  exists to be stolen.
- GitHub Actions are pinned to commit SHAs, with least-privilege `permissions:` per job.
- CodeQL, `pnpm audit`, OpenSSF Scorecard and gitleaks run in CI; a CycloneDX SBOM is attached to
  every release; the image is scanned with Trivy and signed with cosign keyless.
- Renovate runs weekly, grouped, and never auto-merges a runtime dependency.

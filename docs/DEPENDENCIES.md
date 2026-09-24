# Dependencies

Every runtime dependency is a permanent liability: it runs on other people's machines, inside a
process that talks to the network and feeds an LLM. This file exists so adding one is a decision,
not a reflex. **A new runtime dependency needs an entry here and a review.**

[Docs index](README.md) · [Architecture](ARCHITECTURE.md) · [Contributing](../CONTRIBUTING.md)

---

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
| `cheerio`, `jsdom`, any HTML parser               | Phase 0 found a JSON endpoint for every capability, including shop profiles, which looked like it would need HTML. See [ENDPOINTS.md](ENDPOINTS.md).                                                                                  |
| `jalaali-js`, `date-fns-jalali`, `moment-jalaali` | The Jalali→Gregorian conversion is closed-form integer arithmetic, about 40 lines in `lib/fa.ts`. It is a **devDependency** instead, used as the oracle in a property test — so we get the correctness guarantee without shipping it. |
| `axios`, `node-fetch`, `got`                      | `fetch` is built in and is what the injected `Runtime.fetch` expects.                                                                                                                                                                 |
| `lodash`, `ramda`                                 | Nothing here needs them.                                                                                                                                                                                                              |
| A rate-limiter library                            | The token bucket is ~40 lines and has to be swappable per runtime anyway (Workers uses its own binding).                                                                                                                              |
| A telemetry SDK                                   | There is no telemetry, by policy. See [PRIVACY.md](PRIVACY.md).                                                                                                                                                                       |

## Dev dependencies

`typescript`, `vitest`, `@vitest/coverage-v8`, `fast-check`, `jalaali-js` (the Jalali oracle),
`oxlint`, `oxfmt` (see the section above), `tsdown`, `@types/node`. None of these ship.

## Toolchain: oxlint + oxfmt, not Biome

The build brief specifies Biome. This project uses **`oxlint` 1.85 + `oxfmt`** instead. That is a
deliberate amendment, decided by the maintainer, and it is recorded here rather than left to be
discovered in `package.json`.

**What the switch buys**

- Both are Rust, both are fast enough that `pnpm check` is not a thing you avoid running. On a tree
  this size the difference between them is not the deciding factor.
- `oxlint` covers what this project actually needs from a linter: the `correctness` category,
  `typescript/no-explicit-any`, and — the one that matters architecturally —
  `no-restricted-imports`, which is what stops `node:*`, `undici`, `pino` and `lru-cache` from
  leaking into `packages/core/src` and quietly breaking the Workers build in Phase 5.
- Per-directory `overrides`, which is how that ban is scoped to `src` without also blocking tests
  from reading fixtures off disk.

**What it costs, stated plainly**

- `oxfmt` is **0.70.0 — pre-1.0**, against Biome's 2.5.14. For a project that ships to other
  people's machines that is a real asymmetry, and it is the one argument that genuinely favours
  Biome. It is accepted knowingly: a formatter is a development-time tool, it produces no artifact
  that reaches a user, and a regression in it is visible in `git diff` rather than silent.
- Biome's rule catalogue is larger. Nothing currently in use is missing from `oxlint`; if that
  changes, the lint config is small and portable.

**What does not change either way**

The formatter is not a security control, and neither tool is trusted to be one:

- **Autofixes marked unsafe or dangerous are banned** in every script and in CI. This is not
  theoretical — a Biome `--unsafe` fix rewrote `\uXXXX` escapes into **literal control and bidi
  characters** inside `sanitize.ts` and `fa.ts`, the two files whose entire job is removing those
  characters, where no reviewer would have seen them.
- `packages/core/test/source-hygiene.test.ts` fails the build on any literal bidi, control or
  non-ZWNJ zero-width code point anywhere under `packages/` or `apps/`. That guard is the actual
  control; the linter choice sits underneath it.

**Always `pnpm exec`, never `npx`.** `npx biome` resolves to an unrelated package on the npm
registry — a `biome` v10.x that crashes on any multi-file run — rather than `@biomejs/biome`. The
same name-collision hazard applies to any bare tool name, so every script in this repo uses
`pnpm exec`, which resolves from the lockfile.

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

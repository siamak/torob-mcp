# torob-mcp

Unofficial MCP server for torob.com. MIT. TS strict, ESM, Node 22+, pnpm.

## Commands

- `pnpm dev` — stdio, watch mode
- `pnpm dev:http` — Streamable HTTP on 127.0.0.1:3000
- `pnpm test` — fixture/unit/integration/e2e (no network)
- `pnpm test:live` — live smoke tests (opt-in)
- `pnpm check` — oxlint + oxfmt + typecheck
- `pnpm inspect` — MCP Inspector

## Architecture rules

- Monorepo: `packages/core` (runtime-agnostic), `apps/node`, `apps/worker`, `apps/relay`.
- Core uses web-standard APIs only: no `node:*`, no `process`. Platform concerns are injected via `Runtime`.
- Only `packages/core/src/torob/client.ts` touches `runtime.fetch`. Tools never fetch.
- Composite tools declare their subrequest budget up front.
- Every endpoint change updates `docs/ENDPOINTS.md`, its fixture, and its zod schema.
- Errors: typed `TorobError` → mapped to MCP errors in one place.
- Logs go to stderr only (stdout = stdio transport).

## Domain rules

- Prices: Toman, `number`, unit in the field name (`price_toman`).
- All Persian input goes through `src/lib/fa.ts`.
- All third-party text goes through `src/lib/sanitize.ts` before output.
- Tool descriptions are prompts: say when to use and what to call next.
- Outputs stay compact; over about 2k tokens → paginate or summarize.

## Security rules (never violate)

- Host allowlist: torob.com, api.torob.com only — including redirects.
- Never build URLs from unvalidated input.
- HTTP binds to 127.0.0.1 by default; non-local requires auth unless `--insecure`.
- No telemetry, no cookies, no disk persistence.
- No new runtime dependency without a justification in `docs/DEPENDENCIES.md`.
- Never commit real user queries, cookies, or tokens in fixtures.
- Never write an invisible character literally into source — build it from a code point.
  `source-hygiene.test.ts` fails the build otherwise.
- Never run an autofix marked unsafe or dangerous (`oxlint --fix-dangerously`): one rewrote
  `\uXXXX` escapes into real control and bidi characters inside `sanitize.ts`.
- Cache keys and cursor bindings are SHA-256 over canonical JSON. Never truncate an encoding to
  make a key — a collision returns one query's results for another. See docs/ARCHITECTURE.md §5a.
- A filter test must prove the result set narrowed. Torob answers an unknown parameter with 200
  and no filtering.

## Definition of done

oxlint + oxfmt clean, typecheck clean, coverage gates pass, e2e passes, and the Inspector has been checked manually for any tool that changed.

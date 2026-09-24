# Contributing

Thanks for helping. This is an unofficial client for a private API, so a few rules exist that would
be unusual elsewhere.

## Getting started

```bash
pnpm install --frozen-lockfile
pnpm check        # oxlint + oxfmt + typecheck
pnpm test         # offline, deterministic
pnpm build
pnpm inspect      # drive the tools by hand in the MCP Inspector
```

Node 22+ and pnpm. `pnpm test` never touches the network; `pnpm test:live` does and is opt-in.

## Rules that are not negotiable

- **Only `packages/core/src/torob/client.ts` may call `runtime.fetch`.** Tools never fetch.
- **`packages/core` stays runtime-agnostic.** No `node:*`, no `process`, no `undici`, no `pino`.
  Anything platform-specific is injected through `Runtime`. The lint config enforces this and CI
  runs the core suite under both Node and workerd.
- **Every external response is parsed through zod.** No `any`, and no `as` on network data.
- **All third-party text goes through `lib/sanitize.ts`** before it reaches a tool result.
- **Never write an invisible character into source.** Build it from a code point
  (`String.fromCodePoint(0x202e)`) - `packages/core/test/source-hygiene.test.ts` fails the build
  otherwise. This is not hypothetical: a formatter autofix once rewrote `\uXXXX` escapes into real
  control and bidi characters inside the very file that strips them.
- **Never run an autofix marked unsafe or dangerous** (`oxlint --fix-dangerously`). See above.
- **No new runtime dependency** without a justification in `docs/DEPENDENCIES.md`.
- **Never commit real user queries, cookies, tokens, or personal data in fixtures.**

## Changing an endpoint

Touching how we talk to Torob means updating three things together:

1. `docs/ENDPOINTS.md` - the URL, params, field map, and any new gotcha.
2. The fixture in `fixtures/`, re-captured and scrubbed.
3. The zod schema in `packages/core/src/torob/schemas.ts`.

## Testing a filter

A 200 from Torob proves nothing: unknown parameters are ignored silently and answered with an
unfiltered result set. `brands=` looks reasonable and does nothing; the real name is `brand=`.

So any test for a filter must assert the **result set actually narrowed or changed** - never that
the call succeeded. The live tests in `packages/core/test/smoke.live.test.ts` are the model for
this.

## Pull requests

Keep them focused, explain the why in the description, and fill in the security checklist. CI runs
lint, typecheck, tests with coverage gates (90% lines / 85% branches), build, e2e, audit, CodeQL
and gitleaks.

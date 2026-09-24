## What and why

<!-- What changes, and what problem it solves. Link an issue if there is one. -->

## Security checklist

- [ ] No new host is contacted; the allowlist is still `torob.com` and `api.torob.com` only.
- [ ] No URL is built from unvalidated input; ids still go through the validators in `endpoints.ts`.
- [ ] Every new external response is parsed through a zod schema — no `any`, no `as` on network data.
- [ ] All third-party text reaching a tool result goes through `lib/sanitize.ts`.
- [ ] No invisible characters written literally into source (build them from code points).
- [ ] No new runtime dependency, or one justified in `docs/DEPENDENCIES.md`.
- [ ] No secrets, tokens, real user queries, or personal data in fixtures or tests.
- [ ] `packages/core` still imports nothing platform-specific (`node:*`, `process`, `pino`, …).

## If this changes how we talk to Torob

- [ ] `docs/ENDPOINTS.md` updated
- [ ] Fixture re-captured and scrubbed
- [ ] zod schema updated
- [ ] A test asserts the filter **actually narrowed the results** — not merely that the call returned 200

## Verification

- [ ] `pnpm check` clean
- [ ] `pnpm test` passes with the coverage gates
- [ ] Tools that changed were driven by hand in `pnpm inspect`

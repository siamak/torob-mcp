import { defineConfig } from 'vitest/config';

/**
 * Live tests. Opt-in via `pnpm test:live`, run nightly in CI, and never part of the default suite -
 * a Torob outage or a blocked egress IP must not turn a pull request red.
 */
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.live.test.ts'],
    testTimeout: 90_000,
    hookTimeout: 60_000,
    // One file at a time, and no parallel cases: politeness to an API that publishes no limits.
    fileParallelism: false,
    sequence: { concurrent: false },
    retry: 1,
  },
});

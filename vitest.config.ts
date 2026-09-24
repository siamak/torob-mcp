import { defineConfig } from 'vitest/config';

/**
 * The default run is offline and deterministic. Live tests live in vitest.live.config.ts and are
 * opt-in, so a network outage can never turn the suite red.
 */
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.live.test.ts'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: [
        'packages/core/src/torob/**',
        'packages/core/src/tools/**',
        'packages/core/src/lib/**',
      ],
      thresholds: { lines: 90, branches: 85 },
      reporter: ['text-summary', 'lcov'],
    },
  },
});

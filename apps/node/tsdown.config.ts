import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
  treeshake: true,

  /**
   * `@torob-mcp/core` is a private workspace package that is never published, so it MUST be inlined
   * into the bundle. Left external, the published tarball imports a package npm cannot resolve and
   * `npx torob-mcp` dies with ERR_MODULE_NOT_FOUND for every user — a break invisible in this repo,
   * where pnpm links the workspace. `test/package.test.ts` packs the tarball and runs it to keep
   * that honest.
   *
   * Real npm dependencies stay external: they are declared in package.json and installed normally,
   * and bundling pino in particular is a known source of breakage.
   */
  noExternal: [/^@torob-mcp\//],
  external: ['@modelcontextprotocol/sdk', 'zod', 'pino', 'lru-cache'],

  outputOptions: { banner: '#!/usr/bin/env node' },
});

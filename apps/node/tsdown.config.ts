import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
  treeshake: true,
  outputOptions: { banner: '#!/usr/bin/env node' },
});

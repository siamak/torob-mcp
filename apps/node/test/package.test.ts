/**
 * Guards what actually ships.
 *
 * The published tarball is the only artifact users touch, and it is the one thing the rest of the
 * suite cannot see: inside this repo pnpm links the workspace, so a bundle that imports
 * `@torob-mcp/core` externally works perfectly here and dies with ERR_MODULE_NOT_FOUND on every
 * `npx torob-mcp` in the world. That is exactly what happened once. These checks exist so it
 * cannot happen twice.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const BUNDLE = `${APP_DIR}dist/bin.mjs`;
const MANIFEST = `${APP_DIR}package.json`;

interface Manifest {
  name: string;
  bin: Record<string, string>;
  files: string[];
  dependencies: Record<string, string>;
  devDependencies?: Record<string, string>;
  license: string;
  engines: Record<string, string>;
}

let bundle = '';
let manifest: Manifest;

beforeAll(() => {
  if (!existsSync(BUNDLE)) throw new Error('run "pnpm build" before the package tests');
  bundle = readFileSync(BUNDLE, 'utf8');
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
});

describe('the published bundle', () => {
  it('inlines every workspace package', () => {
    // A private workspace package is never published, so importing one externally breaks npx.
    const workspaceImports = [...bundle.matchAll(/from\s+["']([^"']+)["']/g)]
      .map((match) => match[1] ?? '')
      .filter((specifier) => specifier.startsWith('@torob-mcp/'));

    expect(workspaceImports, 'workspace imports must be bundled, not left external').toEqual([]);
  });

  it('imports only dependencies the manifest declares', () => {
    const declared = new Set(Object.keys(manifest.dependencies));
    const bare = [...bundle.matchAll(/from\s+["']([^"']+)["']/g)]
      .map((match) => match[1] ?? '')
      .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'));

    for (const specifier of bare) {
      // Subpath imports such as @scope/pkg/sub resolve through the package root.
      const pkg = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : (specifier.split('/')[0] ?? specifier);
      expect(declared.has(pkg), `${pkg} is imported but not declared in dependencies`).toBe(true);
    }
  });

  it('starts with a shebang so the bin entry is executable', () => {
    expect(bundle.startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('carries no source maps or absolute paths from this machine', () => {
    expect(bundle).not.toContain('sourceMappingURL');
    expect(bundle).not.toContain('/Users/');
  });
});

describe('the published manifest', () => {
  it('does not declare the private workspace package', () => {
    // npm cannot resolve `workspace:*`, so declaring it would fail every install.
    expect(manifest.dependencies).not.toHaveProperty('@torob-mcp/core');
    for (const range of Object.values(manifest.dependencies)) {
      expect(range.startsWith('workspace:'), `${range} is a workspace range`).toBe(false);
    }
  });

  it('points bin at a file that exists', () => {
    const entry = manifest.bin['torob-mcp'];
    expect(entry).toBeDefined();
    expect(existsSync(`${APP_DIR}${(entry ?? '').replace(/^\.\//, '')}`)).toBe(true);
  });

  it('ships the license, readme and dist, and nothing else', () => {
    expect(manifest.files.sort()).toEqual(['LICENSE', 'README.md', 'dist']);
    expect(existsSync(`${APP_DIR}LICENSE`)).toBe(true);
    expect(existsSync(`${APP_DIR}README.md`)).toBe(true);
  });

  it('declares the license and the Node floor', () => {
    expect(manifest.license).toBe('MIT');
    expect(manifest.engines['node']).toBe('>=22');
  });
});

describe('the packed tarball', () => {
  it('contains exactly the files it should', () => {
    // pnpm has no --dry-run for pack, so pack into a temp dir and read the archive back.
    const dir = mkdtempSync(join(tmpdir(), 'torob-pack-'));
    execFileSync('pnpm', ['pack', '--pack-destination', dir], {
      cwd: APP_DIR,
      encoding: 'utf8',
      timeout: 120_000,
    });

    const tarball = readdirSync(dir).find((f) => f.endsWith('.tgz'));
    expect(tarball, 'pnpm pack produced no tarball').toBeDefined();

    const listing = execFileSync('tar', ['-tzf', join(dir, tarball ?? '')], { encoding: 'utf8' });
    const entries = listing
      .split('\n')
      .map((line) => line.replace(/^package\//, '').trim())
      .filter((line) => line.length > 0 && !line.endsWith('/'));

    expect(entries.sort()).toEqual([
      'LICENSE',
      'README.md',
      'dist/bin.d.mts',
      'dist/bin.mjs',
      'package.json',
    ]);

    rmSync(dir, { recursive: true, force: true });
  });
});

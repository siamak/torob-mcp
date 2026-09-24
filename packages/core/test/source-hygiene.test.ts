/**
 * CI guard: no invisible code points may appear literally in source.
 *
 * This exists because a formatter autofix rewrote \uXXXX escapes into real control and bidi
 * characters inside sanitize.ts and fa.ts - putting the exact characters this project strips into
 * the files that strip them, where no reviewer would see them. Escapes and numeric code points are
 * fine; literals are not.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

/** Bidi controls, C0/C1 controls (tab and newline excepted), and zero-width characters bar ZWNJ. */
const FORBIDDEN: { name: string; test: (code: number) => boolean }[] = [
  {
    name: 'C0 control',
    test: (c) => c <= 0x001f && c !== 0x0009 && c !== 0x000a && c !== 0x000d,
  },
  { name: 'C1 control', test: (c) => c >= 0x007f && c <= 0x009f },
  {
    name: 'bidi override or isolate',
    test: (c) => (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069),
  },
  { name: 'arabic letter mark', test: (c) => c === 0x061c },
  {
    name: 'zero-width (non-ZWNJ)',
    test: (c) =>
      c === 0x200b || c === 0x200d || c === 0x200e || c === 0x200f || c === 0xfeff || c === 0x2060,
  },
];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage' || entry === '.git') {
      continue;
    }
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, acc);
    } else if (/\.(ts|mts|js|mjs)$/.test(entry)) {
      acc.push(path);
    }
  }
  return acc;
}

describe('source hygiene', () => {
  const files = [
    ...sourceFiles(join(REPO_ROOT, 'packages')),
    ...sourceFiles(join(REPO_ROOT, 'apps')),
  ];

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('contains no literal bidi, control or non-ZWNJ zero-width code points', () => {
    const offences: string[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const char of line) {
          const code = char.codePointAt(0) ?? 0;
          const rule = FORBIDDEN.find((r) => r.test(code));
          if (rule !== undefined) {
            offences.push(
              `${relative(REPO_ROOT, file)}:${index + 1} contains a literal ${rule.name} (U+${code
                .toString(16)
                .toUpperCase()
                .padStart(4, '0')}) - write it as an escape or a numeric code point`,
            );
          }
        }
      });
    }

    expect(offences).toEqual([]);
  });

  it('detects a planted literal, so the guard itself is known to work', () => {
    // Without this, a broken matcher would report a clean tree forever.
    const planted = `const x = '${String.fromCodePoint(0x202e)}evil';`;
    const found = [...planted].some((char) => {
      const code = char.codePointAt(0) ?? 0;
      return FORBIDDEN.some((r) => r.test(code));
    });
    expect(found).toBe(true);
  });
});

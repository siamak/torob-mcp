import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { argsKey, canonicalJson, decodeCursor, encodeCursor } from '../src/lib/cursor.ts';
import { TorobError } from '../src/torob/errors.ts';

describe('canonicalJson', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('drops undefined and null, which are the same as absent for a query', () => {
    expect(canonicalJson({ a: 1, b: undefined, c: null })).toBe(canonicalJson({ a: 1 }));
  });

  it('keeps array order, because product_ids order is the caller’s', () => {
    expect(canonicalJson({ ids: [1, 2] })).not.toBe(canonicalJson({ ids: [2, 1] }));
  });

  it('does not let a value collide with a different shape', () => {
    // The classic canonicalization bug: {a:"1,b:2"} colliding with {a:1,b:2}.
    expect(canonicalJson({ a: '1', b: '2' })).not.toBe(canonicalJson({ a: '1,b:2' }));
  });
});

describe('argsKey', () => {
  it('is a fixed-width hex digest', async () => {
    expect(await argsKey({ q: 'x' })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('distinguishes the three browse_category sorts', async () => {
    // Regression: argsKey truncated base64, a positional encoding, so these three collapsed onto
    // one cache entry and browse_category returned identical results for all of them.
    const base = { category_id: 94, page: 0, size: 5 };
    const [cheapest, priciest, sellers] = await Promise.all([
      argsKey({ ...base, sort: 'cheapest' }),
      argsKey({ ...base, sort: 'priciest' }),
      argsKey({ ...base, sort: 'most_sellers' }),
    ]);
    expect(new Set([cheapest, priciest, sellers]).size).toBe(3);
  });

  it('survives a long shared prefix', async () => {
    const prefix = 'a'.repeat(200);
    const one = await argsKey({ query: `${prefix}1` });
    const two = await argsKey({ query: `${prefix}2` });
    expect(one).not.toBe(two);
  });

  const argsArb = fc.dictionary(
    fc.string({ minLength: 1, maxLength: 12 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    { maxKeys: 6 },
  );

  it('property: equivalent args produce the same key', async () => {
    await fc.assert(
      fc.asyncProperty(argsArb, async (args) => {
        // Reordered, and padded with members that canonicalization drops.
        const shuffled = Object.fromEntries(Object.entries(args).reverse());
        const padded = { ...shuffled, ignored: undefined, alsoIgnored: null };
        return (await argsKey(args)) === (await argsKey(padded));
      }),
      { numRuns: 100 },
    );
  });

  it('property: distinct canonical args produce distinct keys', async () => {
    await fc.assert(
      fc.asyncProperty(argsArb, argsArb, async (a, b) => {
        fc.pre(canonicalJson(a) !== canonicalJson(b));
        return (await argsKey(a)) !== (await argsKey(b));
      }),
      { numRuns: 200 },
    );
  });
});

describe('cursors', () => {
  const key = 'f'.repeat(64);

  it('round-trips an offset', () => {
    expect(decodeCursor(encodeCursor('search_torob', 40, key), 'search_torob', key)).toBe(40);
  });

  it('property: round-trips any valid offset', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), (offset) =>
        decodeCursor(encodeCursor('t', offset, key), 't', key) === offset,
      ),
      { numRuns: 200 },
    );
  });

  it('rejects a cursor minted by another tool', () => {
    const cursor = encodeCursor('search_torob', 10, key);
    expect(() => decodeCursor(cursor, 'product_sellers', key)).toThrow(TorobError);
  });

  it('rejects a cursor from query A when spent on query B', async () => {
    const keyA = await argsKey({ query: 'laptop', sort: 'cheapest' });
    const keyB = await argsKey({ query: 'phone', sort: 'cheapest' });
    const cursor = encodeCursor('search_torob', 20, keyA);

    expect(decodeCursor(cursor, 'search_torob', keyA)).toBe(20);
    expect(() => decodeCursor(cursor, 'search_torob', keyB)).toThrow(/not valid for search_torob/);
  });

  it('validates decoded contents through zod rather than trusting them', () => {
    const forge = (state: unknown): string =>
      btoa(JSON.stringify(state)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const cases: [string, unknown][] = [
      ['wrong version', { v: 2, t: 't', o: 1, k: key }],
      ['negative offset', { v: 1, t: 't', o: -1, k: key }],
      ['fractional offset', { v: 1, t: 't', o: 1.5, k: key }],
      ['offset past the ceiling', { v: 1, t: 't', o: 10 ** 9, k: key }],
      ['offset of the wrong type', { v: 1, t: 't', o: '1', k: key }],
      ['short key', { v: 1, t: 't', o: 1, k: 'abc' }],
      ['missing key', { v: 1, t: 't', o: 1 }],
      ['extra members', { v: 1, t: 't', o: 1, k: key, injected: 'x' }],
      ['an array', [1, 2, 3]],
      ['a bare string', 'nope'],
      ['null', null],
    ];

    for (const [name, state] of cases) {
      expect(() => decodeCursor(forge(state), 't', key), name).toThrow(TorobError);
    }
  });

  it('rejects garbage without crashing', () => {
    for (const bad of ['', '!!!!', 'x'.repeat(600), 'YWJj']) {
      expect(() => decodeCursor(bad, 't', key)).toThrow(TorobError);
    }
  });

  it('reveals nothing about internals in the message the model sees', () => {
    try {
      decodeCursor('!!!', 'search_torob', key);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TorobError);
      const torob = error as TorobError;
      expect(torob.hint).toBe(
        'that cursor is not valid for search_torob - omit cursor to start from the first page',
      );
      expect(torob.hint).not.toContain(key);
    }
  });
});

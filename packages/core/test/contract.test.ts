/**
 * Contract tests: every committed fixture parsed through its schema.
 *
 * This is the schema-drift alarm. The fixtures are real responses captured during Phase 0
 * (docs/ENDPOINTS.md); when Torob changes a field we depend on, these fail before a user sees a
 * wrong price.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ZodType } from 'zod';
import { describe, expect, it } from 'vitest';
import { assertTomanConsistency } from '../src/lib/money.ts';
import {
  CityListResponseSchema,
  DetailsResponseSchema,
  ErrorBodySchema,
  PriceChartResponseSchema,
  SearchResponseSchema,
  SellersResponseSchema,
  ShopResponseSchema,
  SimilarResponseSchema,
  SuggestionResponseSchema,
} from '../src/torob/schemas.ts';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

function fixture(name: string): unknown {
  const raw: unknown = JSON.parse(readFileSync(`${FIXTURES}${name}.json`, 'utf8'));
  // Fixtures are wrapped as { _fixture: "<provenance>", data: <response> }.
  if (typeof raw === 'object' && raw !== null && 'data' in raw) {
    return (raw as { data: unknown }).data;
  }
  return raw;
}

const cases: [string, ZodType][] = [
  ['search', SearchResponseSchema],
  ['search_category', SearchResponseSchema],
  ['suggestion2', SuggestionResponseSchema],
  ['product_details', DetailsResponseSchema],
  ['product_sellers', SellersResponseSchema],
  ['product_stores', SellersResponseSchema],
  ['price_chart', PriceChartResponseSchema],
  ['similar_products', SimilarResponseSchema],
  ['shop_details', ShopResponseSchema],
  ['city_list', CityListResponseSchema],
];

describe('fixtures parse through their schemas', () => {
  it.each(cases)('%s', (name, schema) => {
    const result = schema.safeParse(fixture(name));
    if (!result.success) {
      throw new Error(
        `${name}.json no longer matches its schema:\n` +
          result.error.issues
            .slice(0, 10)
            .map((i) => `  ${i.path.join('.')}: ${i.message}`)
            .join('\n'),
      );
    }
    expect(result.success).toBe(true);
  });
});

describe('price unit', () => {
  /**
   * The Rial alarm.
   *
   * Torob reports Toman today, verified by hand in Phase 0. If it ever switches `price` to Rial
   * while `price_text` still reads Toman, these stop matching and the suite fails loudly rather
   * than the server confidently reporting prices that are 10x wrong.
   */
  const collectPairs = (value: unknown, acc: [unknown, unknown][] = []): [unknown, unknown][] => {
    if (Array.isArray(value)) {
      for (const item of value) collectPairs(item, acc);
    } else if (typeof value === 'object' && value !== null) {
      const record = value as Record<string, unknown>;
      // Online rows spell it `price_text`; physical-store rows spell it `price_string`.
      const label = record['price_text'] ?? record['price_string'];
      if ('price' in record && typeof label === 'string') {
        acc.push([record['price'], label]);
      }
      for (const nested of Object.values(record)) collectPairs(nested, acc);
    }
    return acc;
  };

  it.each(['search', 'product_details', 'product_sellers', 'product_stores'])(
    '%s reports prices in Toman',
    (name) => {
      const pairs = collectPairs(fixture(name));
      expect(pairs.length).toBeGreaterThan(0);
      for (const [price, priceText] of pairs) {
        expect(
          assertTomanConsistency(price, priceText),
          `price ${String(price)} does not match "${String(priceText)}" - has Torob switched to Rial?`,
        ).toBe(true);
      }
    },
  );
});

describe('upstream error bodies', () => {
  it('matches all three shapes Torob returns under a 404', () => {
    const errors = fixture('errors') as Record<string, { status: number; body: unknown }>;
    for (const [name, entry] of Object.entries(errors)) {
      expect(ErrorBodySchema.safeParse(entry.body).success, name).toBe(true);
    }
  });

  it('still includes the malformed-id case that returns a 200-shaped body', () => {
    // {"random_key":"not-a-uuid"} under a 404 would partially satisfy a product schema, so this
    // case must never quietly disappear from the fixtures.
    const errors = fixture('errors') as Record<string, { status: number; body: unknown }>;
    const entry = errors['malformed_id'];
    expect(entry?.status).toBe(404);
    expect(entry?.body).toHaveProperty('random_key');
  });
});

describe('fixture hygiene', () => {
  it('carries no session identifiers, cookies or contact details', () => {
    const raw = readFileSync(`${FIXTURES}shop_details.json`, 'utf8');
    for (const forbidden of [
      'session_id=',
      'suid=',
      'bvid=',
      'device_id=',
      '@gmail',
      'billing_info',
    ]) {
      expect(raw.includes(forbidden), `shop_details.json must not contain ${forbidden}`).toBe(
        false,
      );
    }
  });

  it('every fixture records where it came from', () => {
    for (const [name] of cases) {
      const raw: unknown = JSON.parse(readFileSync(`${FIXTURES}${name}.json`, 'utf8'));
      expect(raw).toHaveProperty('_fixture');
    }
  });
});

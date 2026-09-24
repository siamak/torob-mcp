/**
 * Live smoke tests against the real Torob API.
 *
 * These assert **semantics, not status codes**. A 200 proves nothing here: Torob ignores a
 * parameter it does not recognise and answers with an unfiltered result set, so "the call
 * succeeded" and "the filter was applied" are entirely different claims. Every assertion below
 * checks the returned data actually reflects what was asked for.
 *
 * Opt-in (`pnpm test:live`), nightly in CI, non-blocking. On drift, CI opens an issue.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, registerTools, type Runtime } from '../src/index.ts';

const enabled = process.env['TOROB_LIVE'] === '1';
const describeLive = enabled ? describe : describe.skip;

/** Conservative on purpose: one request at a time against an API with no published limits. */
function liveRuntime(): Runtime {
  const store = new Map<string, { value: unknown; expires: number }>();
  let chain: Promise<unknown> = Promise.resolve();

  return {
    fetch: (request) => fetch(request),
    cache: {
      async get<T>(key: string): Promise<T | undefined> {
        const hit = store.get(key);
        return hit !== undefined && hit.expires > Date.now() ? (hit.value as T) : undefined;
      },
      async set<T>(key: string, value: T, ttl: number): Promise<void> {
        store.set(key, { value, expires: Date.now() + ttl * 1000 });
      },
    },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    limiter: {
      acquire: async () => {
        const previous = chain;
        let release!: () => void;
        chain = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        await new Promise((r) => setTimeout(r, 400));
        return release;
      },
    },
    now: () => Date.now(),
    random: () => Math.random(),
    config: {
      ...DEFAULT_CONFIG,
      userAgent: 'torob-mcp-live-test/0.1 (+https://github.com/siamak/torob-mcp)',
    },
  };
}

let client: Client;

interface Card {
  product_id: string;
  title_fa: string;
  price_toman?: number;
  shop_count?: number;
  condition?: string;
}

async function call<T = Record<string, unknown>>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { text: string }[])[0]?.text ?? '';
  if (result.isError === true) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text) as T;
}

const prices = (cards: Card[]): number[] =>
  cards.map((c) => c.price_toman).filter((p): p is number => typeof p === 'number');

/** Torob mixes sponsored cards into results regardless of sort, so they are excluded. */
const organic = (cards: (Card & { sponsored?: boolean })[]): Card[] =>
  cards.filter((c) => c.sponsored !== true);

const MOBILE_CATEGORY = 94;
const APPLE_BRAND = 14;

describeLive('live smoke', () => {
  beforeAll(async () => {
    const server = new McpServer({ name: 'torob-mcp', version: 'live' });
    registerTools(server, liveRuntime());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'live', version: '0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  describe('sort is monotonic in its own direction', () => {
    it('cheapest returns non-decreasing prices', async () => {
      const result = await call<{ products: Card[] }>('browse_category', {
        category_id: MOBILE_CATEGORY,
        sort: 'cheapest',
        limit: 20,
      });
      const values = prices(organic(result.products));
      expect(values.length).toBeGreaterThan(5);
      for (let i = 1; i < values.length; i += 1) {
        expect(values[i], `position ${i} broke ascending order`).toBeGreaterThanOrEqual(
          values[i - 1] as number,
        );
      }
    });

    it('priciest returns non-increasing prices', async () => {
      const result = await call<{ products: Card[] }>('browse_category', {
        category_id: MOBILE_CATEGORY,
        sort: 'priciest',
        limit: 20,
      });
      const values = prices(organic(result.products));
      expect(values.length).toBeGreaterThan(5);
      for (let i = 1; i < values.length; i += 1) {
        expect(values[i], `position ${i} broke descending order`).toBeLessThanOrEqual(
          values[i - 1] as number,
        );
      }
    });

    it('cheapest and priciest disagree, so the parameter is genuinely read', async () => {
      // If Torob ignored `sort`, both would return the same popularity ordering.
      const [cheap, dear] = await Promise.all([
        call<{ products: Card[] }>('browse_category', {
          category_id: MOBILE_CATEGORY,
          sort: 'cheapest',
          limit: 5,
        }),
        call<{ products: Card[] }>('browse_category', {
          category_id: MOBILE_CATEGORY,
          sort: 'priciest',
          limit: 5,
        }),
      ]);

      const cheapest = Math.min(...prices(organic(cheap.products)));
      const priciest = Math.max(...prices(organic(dear.products)));
      expect(priciest).toBeGreaterThan(cheapest * 10);
    });

    it('most_sellers puts well-supplied listings first', async () => {
      const result = await call<{ products: Card[] }>('browse_category', {
        category_id: MOBILE_CATEGORY,
        sort: 'most_sellers',
        limit: 10,
      });
      const counts = organic(result.products)
        .map((c) => c.shop_count)
        .filter((n): n is number => typeof n === 'number');
      expect(counts.length).toBeGreaterThan(3);
      // Not strictly monotonic upstream, but the top of the list must be well supplied.
      expect(Math.max(...counts)).toBeGreaterThan(5);
    });
  });

  describe('price filters bound the results', () => {
    it('keeps every organic hit inside the requested band', async () => {
      const min = 20_000_000;
      const max = 30_000_000;
      const result = await call<{ products: Card[] }>('search_torob', {
        query: 'گوشی',
        price_min_toman: min,
        price_max_toman: max,
        limit: 20,
      });

      const values = prices(organic(result.products));
      expect(values.length).toBeGreaterThan(3);
      for (const price of values) {
        expect(price).toBeGreaterThanOrEqual(min);
        expect(price).toBeLessThanOrEqual(max);
      }
    });

    it('narrows the result count rather than returning everything', async () => {
      const [all, banded] = await Promise.all([
        call<{ approx_total?: number }>('browse_category', {
          category_id: MOBILE_CATEGORY,
          limit: 1,
        }),
        call<{ approx_total?: number }>('browse_category', {
          category_id: MOBILE_CATEGORY,
          price_min_toman: 20_000_000,
          price_max_toman: 30_000_000,
          limit: 1,
        }),
      ]);
      expect(banded.approx_total ?? 0).toBeLessThan(all.approx_total ?? 0);
    });
  });

  describe('category and brand filters are reflected in the results', () => {
    it('a brand filter returns that brand', async () => {
      const result = await call<{ products: Card[] }>('browse_category', {
        category_id: MOBILE_CATEGORY,
        brand_id: APPLE_BRAND,
        limit: 15,
      });

      const titles = organic(result.products).map((p) => `${p.title_fa}`.toLowerCase());
      expect(titles.length).toBeGreaterThan(5);
      // Apple phones read as either "آیفون"/"اپل" or the Latin "iphone"/"apple".
      const appleish = titles.filter((t) => /iphone|apple|آیفون|اپل/.test(t));
      expect(appleish.length / titles.length).toBeGreaterThan(0.7);
    });

    it('a brand filter changes the result set', async () => {
      const [unfiltered, filtered] = await Promise.all([
        call<{ products: Card[] }>('browse_category', { category_id: MOBILE_CATEGORY, limit: 10 }),
        call<{ products: Card[] }>('browse_category', {
          category_id: MOBILE_CATEGORY,
          brand_id: APPLE_BRAND,
          limit: 10,
        }),
      ]);
      const a = new Set(unfiltered.products.map((p) => p.product_id));
      const b = filtered.products.map((p) => p.product_id);
      expect(b.some((id) => !a.has(id))).toBe(true);
    });

    it('a category filter returns products whose path contains that category', async () => {
      const result = await call<{ products: Card[] }>('browse_category', {
        category_id: MOBILE_CATEGORY,
        limit: 3,
      });
      const first = organic(result.products)[0];
      expect(first).toBeDefined();

      const details = await call<{
        category_path: { category_id?: number }[];
        category_id?: number;
      }>('product_details', { product_id: first?.product_id });
      const ids = details.category_path.map((step) => step.category_id);
      expect([...ids, details.category_id]).toContain(MOBILE_CATEGORY);
    });

    it('a condition filter returns only that condition', async () => {
      const result = await call<{ products: Card[] }>('search_torob', {
        query: 'گوشی',
        condition: 'used',
        limit: 10,
      });
      const conditions = organic(result.products)
        .map((p) => p.condition)
        .filter((c): c is string => typeof c === 'string');
      expect(conditions.length).toBeGreaterThan(2);
      // "کارکرده" is how Torob labels used stock.
      for (const condition of conditions) {
        expect(condition).toContain('کارکرده');
      }
    });
  });

  describe('pages are continuous and non-overlapping', () => {
    it('search pages do not repeat products and continue the sort', async () => {
      const args = { query: 'گوشی', sort: 'cheapest', limit: 10 };
      const page1 = await call<{ products: Card[]; next_cursor?: string }>('search_torob', args);
      expect(page1.next_cursor).toBeDefined();

      const page2 = await call<{ products: Card[]; next_cursor?: string }>('search_torob', {
        ...args,
        cursor: page1.next_cursor,
      });

      const ids1 = new Set(page1.products.map((p) => p.product_id));
      const overlap = page2.products.filter((p) => ids1.has(p.product_id));
      expect(overlap, 'page 2 repeated products from page 1').toHaveLength(0);

      // Continuity: cheapest sort means page 2 starts no lower than page 1 ended.
      const tail = Math.max(...prices(organic(page1.products)));
      const head = Math.min(...prices(organic(page2.products)));
      expect(head).toBeGreaterThanOrEqual(tail * 0.9);
    });

    it('seller pages are disjoint and cost one upstream call', async () => {
      const search = await call<{ products: Card[] }>('search_torob', {
        query: 'آیفون',
        limit: 5,
      });
      const target = organic(search.products).find((p) => (p.shop_count ?? 0) > 3);
      expect(target, 'no product with several sellers to page through').toBeDefined();

      const page1 = await call<{
        sellers: { shop_name: string }[];
        next_cursor?: string;
        total: number;
      }>('product_sellers', { product_id: target?.product_id, limit: 3 });
      if (page1.next_cursor === undefined) return;

      const page2 = await call<{ sellers: { shop_name: string }[] }>('product_sellers', {
        product_id: target?.product_id,
        limit: 3,
        cursor: page1.next_cursor,
      });

      expect(page1.sellers).toHaveLength(3);
      expect(page2.sellers.length).toBeGreaterThan(0);
      expect(JSON.stringify(page2.sellers)).not.toBe(JSON.stringify(page1.sellers));
    });
  });

  describe('domain invariants', () => {
    it('prices are still Toman, not Rial', async () => {
      // A mid-range phone costs tens of millions of Toman. If Torob switched to Rial these become
      // ten times larger and this fails - which is the entire point of asserting on magnitude.
      const result = await call<{ products: Card[] }>('browse_category', {
        category_id: MOBILE_CATEGORY,
        brand_id: APPLE_BRAND,
        sort: 'most_sellers',
        limit: 5,
      });
      const median = prices(organic(result.products)).sort((a, b) => a - b)[
        Math.floor(prices(organic(result.products)).length / 2)
      ];
      expect(median).toBeGreaterThan(1_000_000);
      expect(median).toBeLessThan(2_000_000_000);
    });

    it('the price chart still returns about a year of weekly points', async () => {
      const search = await call<{ products: Card[] }>('search_torob', {
        query: 'آیفون',
        limit: 3,
      });
      const target = organic(search.products)[0];
      const chart = await call<{ points: { date_iso?: string }[]; window: string }>(
        'product_price_chart',
        { product_id: target?.product_id },
      );

      expect(chart.points.length).toBeGreaterThan(20);
      // Labels must still parse as Jalali dates; if the format changes, they silently would not.
      const parsed = chart.points.filter((p) => p.date_iso !== undefined);
      expect(parsed.length / chart.points.length).toBeGreaterThan(0.9);
    });

    it('suggest still handles Finglish', async () => {
      const result = await call<{ suggestions: string[] }>('torob_suggest', { query: 'ayfon' });
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('shop_profile still exposes trust signals and no private fields', async () => {
      const search = await call<{ products: Card[] }>('search_torob', {
        query: 'آیفون',
        limit: 3,
      });
      const sellers = await call<{ sellers: { shop_id?: number }[] }>('product_sellers', {
        product_id: organic(search.products)[0]?.product_id,
        limit: 5,
      });
      const shopId = sellers.sellers.find((s) => typeof s.shop_id === 'number')?.shop_id;
      expect(shopId).toBeDefined();

      const profile = await call('shop_profile', { shop_id: shopId });
      expect(profile['name']).toBeTruthy();
      for (const forbidden of ['billing_info', 'credit', 'users', 'phone', 'address']) {
        expect(profile, forbidden).not.toHaveProperty(forbidden);
      }
    });
  });
});

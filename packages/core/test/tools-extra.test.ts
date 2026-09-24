/**
 * The composite and interpretive tools: find_best_value, search_filters, torob_suggest,
 * compare_products, get_products_batch, product_stores and the price-chart verdict.
 *
 * These carry logic of our own - ranking, verdicts, city resolution, spec diffing - so they are
 * tested against synthetic payloads where the expected answer is known exactly.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { registerTools, type Runtime } from '../src/index.ts';
import { json, memoryCache, recordingFetch, testRuntime } from './helpers.ts';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const fixture = (name: string): unknown => {
  const raw: unknown = JSON.parse(readFileSync(`${FIXTURES}${name}.json`, 'utf8'));
  return typeof raw === 'object' && raw !== null && 'data' in raw ? (raw as { data: unknown }).data : raw;
};

const PRODUCT_ID = '57ea65ae-0798-4cd0-96a7-38d8af180345';
const OTHER_ID = '935d1506-022e-43b8-b94e-b2543158bcd5';

async function connect(runtime: Runtime): Promise<Client> {
  const server = new McpServer({ name: 'torob-mcp', version: 'test' });
  registerTools(server, runtime);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(a), server.connect(b)]);
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ isError: boolean; text: string; data: Record<string, unknown> }> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { text: string }[])[0]?.text ?? '';
  return {
    isError: result.isError === true,
    text,
    data: result.isError === true ? {} : (JSON.parse(text) as Record<string, unknown>),
  };
}

const card = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  random_key: PRODUCT_ID,
  name1: 'product',
  price: 1_000_000,
  shop_text: 'در ۵ فروشگاه',
  web_client_absolute_url: '/p/x/',
  ...over,
});

describe('find_best_value', () => {
  const body = {
    results: [
      card({ random_key: '11111111-1111-4111-8111-111111111111', name1: 'cheap, many sellers', price: 200_000, shop_text: 'در ۳۰۰ فروشگاه' }),
      card({ random_key: '22222222-2222-4222-8222-222222222222', name1: 'near budget', price: 1_900_000, shop_text: 'در ۲ فروشگاه' }),
      card({ random_key: '33333333-3333-4333-8333-333333333333', name1: 'over budget', price: 9_000_000 }),
    ],
    count: 3,
  };

  it('drops anything over budget and ranks headroom plus supply first', async () => {
    const { fetch } = recordingFetch({ responses: [json(body)] });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'find_best_value', { query: 'x', budget_toman: 2_000_000 });

    const picks = data['picks'] as Record<string, unknown>[];
    expect(picks).toHaveLength(2);
    expect(picks[0]?.['title_fa']).toBe('cheap, many sellers');
    expect(picks[0]?.['value_score']).toBeGreaterThan(picks[1]?.['value_score'] as number);
    expect(picks[0]?.['why']).toContain('under budget');
  });

  it('says the score is ours, not Torob’s', async () => {
    const { fetch } = recordingFetch({ responses: [json(body)] });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'find_best_value', { query: 'x', budget_toman: 2_000_000 });
    expect(data['note']).toContain('not a Torob rating');
  });

  it('sends the budget upstream as an upper price bound', async () => {
    const { fetch, calls } = recordingFetch({ responses: [json(body)] });
    const client = await connect(testRuntime({ fetch }));
    await call(client, 'find_best_value', { query: 'x', budget_toman: 2_000_000, must_be_new: true });

    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('price__lt')).toBe('2000000');
    expect(url.searchParams.get('stock_status')).toBe('new');
    expect(url.searchParams.get('available')).toBe('true');
  });

  it('returns an empty list rather than inventing picks', async () => {
    const { fetch } = recordingFetch({ responses: [json({ results: [], count: 0 })] });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'find_best_value', { query: 'x', budget_toman: 1_000_000 });
    expect(data['picks']).toEqual([]);
  });
});

describe('search_filters', () => {
  it('surfaces categories, brands and the price span', async () => {
    const { fetch } = recordingFetch({ responses: [json(fixture('search_category'))] });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'search_filters', { category_id: 94 });

    expect((data['categories'] as unknown[]).length).toBeGreaterThan(0);
    expect((data['brands'] as { brand_id: number }[])[0]?.brand_id).toBeTypeOf('number');
    expect(data['price_span_toman']).toBeDefined();
    expect(data['sorts']).toContain('cheapest');
  });

  it('falls back to the brand endpoint when the search response carries no brands', async () => {
    const thin = { results: [], count: 0, filters1: [], categories: [] };
    const { fetch, calls } = recordingFetch({
      responses: [json(thin), json(fixture('search_category'))],
    });
    // The second stub stands in for /v4/brand/list/, which returns a bare array; a mismatch is
    // tolerated and simply yields no brands.
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'search_filters', { category_id: 94 });

    expect(calls.length).toBe(2);
    expect(calls[1]?.url).toContain('/v4/brand/list/');
    expect(data['brands']).toEqual([]);
  });

  it('uses the brand endpoint result when it parses', async () => {
    const thin = { results: [], count: 0, filters1: [], categories: [] };
    const brands = [{ id: 14, name1: 'اپل', name2: 'Apple' }];
    const { fetch } = recordingFetch({ responses: [json(thin), json(brands)] });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'search_filters', { category_id: 94 });

    expect(data['brands']).toEqual([{ brand_id: 14, name_fa: 'اپل', name_en: 'Apple' }]);
  });

  it('works from a query with no category', async () => {
    const { fetch, calls } = recordingFetch({ responses: [json(fixture('search'))] });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'search_filters', { query: 'iphone' });
    expect(calls).toHaveLength(1);
    expect(data['categories']).toBeDefined();
  });
});

describe('torob_suggest', () => {
  it('combines autocomplete with the spellcheck correction', async () => {
    const { fetch, calls } = recordingFetch({
      responses: [
        json([{ text: 'ayfon 13' }, { text: 'ayfon 16' }, { text: 'ayfon 13' }]),
        json({ results: [], count: 0, spellcheck: { is_spellchecked: true, corrected_query: 'iphone' } }),
      ],
    });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'torob_suggest', { query: 'ayfon' });

    // Duplicates are collapsed.
    expect(data['suggestions']).toEqual(['ayfon 13', 'ayfon 16']);
    expect(data['spelling_correction']).toBe('iphone');
    expect(calls).toHaveLength(2);
  });

  it('tolerates one source failing', async () => {
    const { fetch } = recordingFetch({
      responses: [json([{ text: 'ayfon 13' }]), json({ message: 'nope' }, 404)],
    });
    const client = await connect(testRuntime({ fetch }));
    const { data, isError } = await call(client, 'torob_suggest', { query: 'ayfon' });

    expect(isError).toBe(false);
    expect(data['suggestions']).toEqual(['ayfon 13']);
    expect(data).not.toHaveProperty('spelling_correction');
  });

  it('reports failure only when both sources fail', async () => {
    const { fetch } = recordingFetch({ responses: [json({ message: 'nope' }, 404)] });
    const client = await connect(testRuntime({ fetch }));
    const { isError } = await call(client, 'torob_suggest', { query: 'ayfon' });
    expect(isError).toBe(true);
  });

  it('omits the correction when Torob did not correct anything', async () => {
    const { fetch } = recordingFetch({
      responses: [
        json([{ text: 'iphone' }]),
        json({ results: [], count: 0, spellcheck: { is_spellchecked: false, corrected_query: '' } }),
      ],
    });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'torob_suggest', { query: 'iphone' });
    expect(data).not.toHaveProperty('spelling_correction');
  });
});

describe('price-chart verdict', () => {
  /** A 12-week minimum series, so the percentile maths has something definite to work on. */
  const chart = (values: number[]): unknown => ({
    labels: values.map((_, i) => `${i + 1} آبان ۱۴۰۴`),
    dataSets: [
      {
        label: 'کمترین قیمت',
        entries: values.map((val, i) => ({ val, i })),
      },
      {
        label: 'میانگین قیمت',
        entries: values.map((val, i) => ({ val: val * 1.1, i })),
      },
    ],
  });

  const series = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((n) => n * 1_000_000);

  const verdictFor = async (currentMin: number): Promise<Record<string, unknown>> => {
    const { fetch } = recordingFetch({
      responses: [json(chart(series)), json({ random_key: PRODUCT_ID, min_price: currentMin })],
    });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'product_price_chart', { product_id: PRODUCT_ID });
    return data;
  };

  it('calls a price at the bottom of the range great', async () => {
    const data = await verdictFor(10_000_000);
    expect(data['verdict']).toBe('great');
    expect(data['verdict_reason']).toContain('25th percentile');
  });

  it('calls a mid-range price fair', async () => {
    const data = await verdictFor(16_000_000);
    expect(data['verdict']).toBe('fair');
  });

  it('calls a price at the top of the range high', async () => {
    const data = await verdictFor(21_000_000);
    expect(data['verdict']).toBe('high');
    expect(data['verdict_reason']).toContain('75th percentile');
  });

  it('says unknown rather than guessing when history is thin', async () => {
    const { fetch } = recordingFetch({
      responses: [json(chart([1_000_000, 2_000_000])), json({ random_key: PRODUCT_ID, min_price: 1_500_000 })],
    });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'product_price_chart', { product_id: PRODUCT_ID });

    expect(data['verdict']).toBe('unknown');
    expect(data['verdict_reason']).toContain('not enough');
  });

  it('says unknown when the product has no current price', async () => {
    const { fetch } = recordingFetch({
      responses: [json(chart(series)), json({ random_key: PRODUCT_ID })],
    });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'product_price_chart', { product_id: PRODUCT_ID });
    expect(data['verdict']).toBe('unknown');
  });

  it('ignores a series label it does not recognise', async () => {
    const odd = {
      labels: ['1 آبان ۱۴۰۴'],
      dataSets: [{ label: 'something new', entries: [{ val: 5, i: 0 }] }],
    };
    const { fetch } = recordingFetch({
      responses: [json(odd), json({ random_key: PRODUCT_ID, min_price: 5 })],
    });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'product_price_chart', { product_id: PRODUCT_ID });

    const points = data['points'] as Record<string, unknown>[];
    expect(points[0]).not.toHaveProperty('min_toman');
  });
});

describe('compare_products', () => {
  const withSpecs = (id: string, price: number, storage: string): unknown => ({
    random_key: id,
    name1: `phone ${storage}`,
    min_price: price,
    structural_specs: {
      headers: [{ header: 'general', specs: { storage, brand: 'Apple' } }],
    },
  });

  it('lists only the specs that differ and names the cheapest', async () => {
    const { fetch } = recordingFetch({
      responses: [json(withSpecs(PRODUCT_ID, 5_000_000, '128GB')), json(withSpecs(OTHER_ID, 3_000_000, '256GB'))],
    });
    const client = await connect(testRuntime({ fetch, cache: memoryCache() }));
    const { data } = await call(client, 'compare_products', { product_ids: [PRODUCT_ID, OTHER_ID] });

    const diff = data['spec_diff'] as { spec: string }[];
    expect(diff.map((d) => d.spec)).toContain('storage');
    // Identical across both, so it must not appear.
    expect(diff.map((d) => d.spec)).not.toContain('brand');
    expect(data['cheapest_id']).toBe(OTHER_ID);
  });

  it('declares its budget before fetching anything', async () => {
    const base = testRuntime();
    const { fetch, calls } = recordingFetch({ responses: [json(withSpecs(PRODUCT_ID, 1, 'x'))] });
    const client = await connect({ ...base, fetch, config: { ...base.config, maxSubrequests: 1 } });

    const { isError } = await call(client, 'compare_products', { product_ids: [PRODUCT_ID, OTHER_ID] });
    expect(isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('get_products_batch', () => {
  it('reports unknown ids without losing the good ones', async () => {
    const { fetch } = recordingFetch({
      responses: [
        json({ random_key: PRODUCT_ID, name1: 'real', min_price: 1_000_000 }),
        json({ message: 'Base product not found' }, 404),
      ],
    });
    const client = await connect(testRuntime({ fetch, cache: memoryCache() }));
    const { data } = await call(client, 'get_products_batch', { product_ids: [PRODUCT_ID, OTHER_ID] });

    expect((data['products'] as unknown[])).toHaveLength(1);
    expect(data['not_found']).toEqual([OTHER_ID]);
  });
});

describe('product_url', () => {
  it('fetches the title only when asked', async () => {
    const { fetch, calls } = recordingFetch({
      responses: [json({ random_key: PRODUCT_ID, name1: 'the title' })],
    });
    const client = await connect(testRuntime({ fetch }));

    const { data } = await call(client, 'product_url', { product_id: PRODUCT_ID, include_title: true });
    expect(data['title_fa']).toBe('the title');
    expect(calls).toHaveLength(1);
  });
});

describe('product_stores', () => {
  const store = (city: string, price: number, extra: Record<string, unknown> = {}): unknown => ({
    shop_name: `shop in ${city}`,
    shop_name2: city,
    price,
    ...extra,
  });

  it('resolves a city name to an id and sends it as the derived header', async () => {
    const { fetch, calls } = recordingFetch({
      responses: [
        json({ count: 1, results: [{ id: 712, name: 'لار' }] }),
        json({ results: [store('لار', 5_000_000)], count: 1 }),
      ],
    });
    const client = await connect(testRuntime({ fetch, cache: memoryCache() }));
    const { data } = await call(client, 'product_stores', {
      product_id: PRODUCT_ID,
      city: 'لار',
    });

    expect(calls[0]?.url).toContain('/v4/city/list/');
    expect(calls[1]?.headers['cookie']).toBe('deliver_city=712');
    expect(data['city_applied']).toBe('لار');
  });

  it('prefers an exact city match over a longer name that merely contains it', async () => {
    // "لار" must not resolve to "ملارد".
    const { fetch, calls } = recordingFetch({
      responses: [
        json({
          count: 2,
          results: [
            { id: 393, name: 'ملارد' },
            { id: 712, name: 'لار' },
          ],
        }),
        json({ results: [], count: 0 }),
      ],
    });
    const client = await connect(testRuntime({ fetch, cache: memoryCache() }));
    await call(client, 'product_stores', { product_id: PRODUCT_ID, city: 'لار' });

    expect(calls[1]?.headers['cookie']).toBe('deliver_city=712');
  });

  it('says so when the city could not be resolved', async () => {
    const { fetch, calls } = recordingFetch({
      responses: [json({ count: 0, results: [] }), json({ results: [], count: 0 })],
    });
    const client = await connect(testRuntime({ fetch, cache: memoryCache() }));
    const { data } = await call(client, 'product_stores', {
      product_id: PRODUCT_ID,
      city: 'nowhere',
    });

    expect(data).not.toHaveProperty('city_applied');
    expect(data['note']).toContain('no city matching');
    expect(calls[1]?.headers).not.toHaveProperty('cookie');
  });

  it('carries opening hours through to the output', async () => {
    const { fetch } = recordingFetch({
      responses: [
        json({
          results: [
            store('تهران', 1_000_000, {
              is_open: false,
              supports_fast_delivery: true,
              working_hours: { title: { status: 'بسته', text: 'until 09:00' } },
            }),
          ],
          count: 1,
        }),
      ],
    });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'product_stores', { product_id: PRODUCT_ID });

    const stores = data['stores'] as Record<string, unknown>[];
    expect(stores[0]?.['is_open']).toBe(false);
    expect(stores[0]?.['fast_delivery']).toBe(true);
    expect(stores[0]?.['hours_today']).toContain('until 09:00');
  });
});

describe('seller ranking', () => {
  const offer = (price: number, extra: Record<string, unknown> = {}): unknown => ({
    shop_name: `shop-${price}`,
    price,
    availability: true,
    ...extra,
  });

  it('best_value demotes unreliable and out-of-stock offers below price order', async () => {
    const { fetch } = recordingFetch({
      responses: [
        json({
          results: [
            offer(1_000_000, { is_price_unreliable: true }),
            offer(2_000_000, { availability: false }),
            offer(3_000_000),
          ],
          count: 3,
        }),
      ],
    });
    const client = await connect(testRuntime({ fetch, cache: memoryCache() }));
    const { data } = await call(client, 'product_sellers', { product_id: PRODUCT_ID, limit: 3 });

    const sellers = data['sellers'] as Record<string, unknown>[];
    expect(sellers[0]?.['price_toman']).toBe(3_000_000);
    expect(sellers[2]?.['price_unreliable']).toBe(true);
  });

  it('cheapest sorts on price alone, warts and all', async () => {
    const { fetch } = recordingFetch({
      responses: [
        json({
          results: [offer(3_000_000), offer(1_000_000, { is_price_unreliable: true })],
          count: 2,
        }),
      ],
    });
    const client = await connect(testRuntime({ fetch, cache: memoryCache() }));
    const { data } = await call(client, 'product_sellers', {
      product_id: PRODUCT_ID,
      sort: 'cheapest',
      limit: 2,
    });

    const sellers = data['sellers'] as Record<string, unknown>[];
    expect(sellers[0]?.['price_toman']).toBe(1_000_000);
    // The warning travels with it.
    expect(sellers[0]?.['price_unreliable']).toBe(true);
  });

  it('in_stock_only removes unavailable offers', async () => {
    const { fetch } = recordingFetch({
      responses: [
        json({ results: [offer(1_000_000, { availability: false }), offer(2_000_000)], count: 2 }),
      ],
    });
    const client = await connect(testRuntime({ fetch, cache: memoryCache() }));
    const { data } = await call(client, 'product_sellers', {
      product_id: PRODUCT_ID,
      in_stock_only: true,
      limit: 5,
    });

    expect(data['total']).toBe(1);
  });
});

describe('shop_profile with a sparse payload', () => {
  it('omits what is missing rather than emitting empty fields', async () => {
    const { fetch } = recordingFetch({ responses: [json({ id: 1, name: 'minimal shop' })] });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'shop_profile', { shop_id: 1 });

    expect(data['name']).toBe('minimal shop');
    expect(data).not.toHaveProperty('enamad');
    expect(data).not.toHaveProperty('city');
    expect(data['note']).toContain('enamad');
  });
});

describe('product_variants with no siblings', () => {
  it('says so plainly', async () => {
    const { fetch } = recordingFetch({ responses: [json({ random_key: PRODUCT_ID, name1: 'x' })] });
    const client = await connect(testRuntime({ fetch }));
    const { data } = await call(client, 'product_variants', { product_id: PRODUCT_ID });

    expect(data['groups']).toEqual([]);
    expect(data['note']).toContain('no variants');
  });
});

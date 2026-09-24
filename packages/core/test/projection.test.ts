/**
 * Projection edge cases.
 *
 * Every optional field has two paths - present and absent - and upstream is inconsistent about
 * which it sends. These feed a maximal payload and a minimal one through the same tools so both
 * sides are exercised, and assert the absent case omits the key rather than emitting null.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { notFound, TorobError } from '../src/torob/errors.ts';
import { registerTools, type Runtime } from '../src/index.ts';
import { json, memoryCache, recordingFetch, testRuntime } from './helpers.ts';

const PRODUCT_ID = '57ea65ae-0798-4cd0-96a7-38d8af180345';

async function connect(runtime: Runtime): Promise<Client> {
  const server = new McpServer({ name: 'torob-mcp', version: 'test' });
  registerTools(server, runtime);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([client.connect(a), server.connect(b)]);
  return client;
}

async function data(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { text: string }[])[0]?.text ?? '';
  if (result.isError === true) throw new Error(text);
  return JSON.parse(text) as Record<string, unknown>;
}

describe('search results with everything present', () => {
  it('carries every optional field through', async () => {
    const rich = {
      results: [
        {
          random_key: PRODUCT_ID,
          name1: 'گوشی',
          name2: 'Phone',
          price: 5_000_000,
          shop_text: 'در ۷ فروشگاه',
          stock_status: 'نو',
          web_client_absolute_url: '/p/x/',
          is_adv: true,
          has_nearby_shop: true,
          is_authentic: true,
          badges: [{ text: 'badge-one' }, { text: 'badge-two' }],
        },
      ],
      count: 42,
      min_price: 1000.0,
      max_price: 9_000_000.5,
      spellcheck: { is_spellchecked: true, corrected_query: 'corrected' },
      categories: [{ title: 'Phones', cat_id: 94 }],
    };

    const { fetch } = recordingFetch({ responses: [json(rich)] });
    const client = await connect(testRuntime({ fetch }));
    const result = await data(client, 'search_torob', {
      query: 'x',
      price_min_toman: 1000,
      limit: 1,
    });

    const card = (result['products'] as Record<string, unknown>[])[0];
    expect(card).toMatchObject({
      product_id: PRODUCT_ID,
      title_en: 'Phone',
      price_toman: 5_000_000,
      shop_count: 7,
      is_ad: true,
      has_local_seller: true,
      badges: ['badge-one', 'badge-two'],
    });
    expect(result['approx_total']).toBe(42);
    // Floats are rounded at the projection boundary.
    expect(result['price_span_toman']).toEqual({ min: 1000, max: 9_000_001 });
    expect(result['spelling_correction']).toBe('corrected');
    expect(result['suggested_categories']).toEqual([{ title: 'Phones', category_id: 94 }]);
    // The note mentions the price filter only when one was given.
    expect(result['note']).toContain('unfiltered query');
  });
});

describe('search results with nothing optional present', () => {
  it('omits absent fields instead of emitting nulls', async () => {
    const bare = { results: [{ random_key: PRODUCT_ID, name1: 'x' }] };
    const { fetch } = recordingFetch({ responses: [json(bare)] });
    const client = await connect(testRuntime({ fetch }));
    // limit 2 with one result: a short page proves there is no next page. At limit 1 a full page
    // is indistinguishable from a last page, so a cursor would correctly be minted.
    const result = await data(client, 'search_torob', { query: 'x', limit: 2 });

    const card = (result['products'] as Record<string, unknown>[])[0];
    for (const absent of ['title_en', 'price_toman', 'shop_count', 'condition', 'is_ad', 'badges']) {
      expect(card, absent).not.toHaveProperty(absent);
    }
    // A missing url falls back to the canonical form rather than a broken relative path.
    expect(card?.['url']).toBe(`https://torob.com/p/${PRODUCT_ID}/`);

    for (const absent of ['approx_total', 'price_span_toman', 'spelling_correction', 'suggested_categories', 'next_cursor']) {
      expect(result, absent).not.toHaveProperty(absent);
    }
  });

  it('treats a zero price as no price', async () => {
    const { fetch } = recordingFetch({
      responses: [json({ results: [{ random_key: PRODUCT_ID, name1: 'x', price: 0 }] })],
    });
    const client = await connect(testRuntime({ fetch }));
    const result = await data(client, 'search_torob', { query: 'x', limit: 1 });
    expect((result['products'] as Record<string, unknown>[])[0]).not.toHaveProperty('price_toman');
  });
});

describe('seller projection edges', () => {
  it('carries the full trust record when upstream sends one', async () => {
    const { fetch } = recordingFetch({
      responses: [
        json({
          results: [
            {
              shop_name: 'shop',
              shop_name2: 'تهران',
              shop_id: 5,
              name1: 'listing title',
              name2: 'listing note',
              price: 1_000_000,
              availability: true,
              shop_score: 5,
              shop_score_percentile: 90,
              score_info: { complaints_info: { summary: ['one', 'two'] } },
              last_price_change_date: '۶ ساعت پیش',
              guarantee_info: { status: 'enabled' },
              is_filtered_by_bnpl: true,
              has_public_torob_profile: true,
              more_info: { shipping_types: ['post'] },
            },
          ],
          count: 1,
        }),
      ],
    });
    const client = await connect(testRuntime({ fetch, cache: memoryCache() }));
    const result = await data(client, 'product_sellers', { product_id: PRODUCT_ID });

    expect((result['sellers'] as Record<string, unknown>[])[0]).toMatchObject({
      shop_id: 5,
      shop_city: 'تهران',
      trust: { score: 5, percentile: 90, summary: ['one', 'two'] },
      torob_warranty: true,
      installment_available: true,
      has_torob_profile: true,
      shipping: ['post'],
      listing_title: 'listing title',
      listing_note: 'listing note',
    });
  });

  it('omits a percentile of zero, which upstream uses to mean "unrated"', async () => {
    const { fetch } = recordingFetch({
      responses: [json({ results: [{ shop_name: 'shop', price: 1, shop_score_percentile: 0 }], count: 1 })],
    });
    const client = await connect(testRuntime({ fetch, cache: memoryCache() }));
    const result = await data(client, 'product_sellers', { product_id: PRODUCT_ID });

    const trust = (result['sellers'] as { trust: Record<string, unknown> }[])[0]?.trust;
    expect(trust).not.toHaveProperty('percentile');
  });
});

describe('details projection edges', () => {
  it('drops the site root from the category path and keeps the brand step', async () => {
    const { fetch } = recordingFetch({
      responses: [
        json({
          random_key: PRODUCT_ID,
          name1: 'x',
          breadcrumbs: [
            { title: 'ترب', cat_id: 0, brand_id: null },
            { title: 'Phones', cat_id: 94, brand_id: null },
            { title: 'Apple', cat_id: 94, brand_id: 14 },
            { title: '', cat_id: 5 },
          ],
        }),
      ],
    });
    const client = await connect(testRuntime({ fetch }));
    const result = await data(client, 'product_details', { product_id: PRODUCT_ID });

    expect(result['category_path']).toEqual([
      { title: 'Phones', category_id: 94 },
      { title: 'Apple', category_id: 94, brand_id: 14 },
    ]);
  });

  it('falls back to the shop_text count when products_info is absent', async () => {
    const { fetch } = recordingFetch({
      responses: [
        json({
          random_key: PRODUCT_ID,
          name1: 'x',
          shop_text: 'در ۱۱ فروشگاه',
        }),
      ],
    });
    const client = await connect(testRuntime({ fetch }));
    const result = await data(client, 'product_details', { product_id: PRODUCT_ID });
    expect(result['seller_count']).toBe(11);
  });

  it('caps the spec table so one product cannot blow the output budget', async () => {
    const specs = Object.fromEntries(
      Array.from({ length: 80 }, (_, i) => [`key ${i}`, `value ${i}`]),
    );
    const { fetch } = recordingFetch({
      responses: [
        json({
          random_key: PRODUCT_ID,
          name1: 'x',
          structural_specs: { headers: [{ header: 'h', specs }] },
          key_specs: [
            {
              header: 'k',
              items: Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, value: [`v${i}`] })),
            },
          ],
        }),
      ],
    });
    const client = await connect(testRuntime({ fetch }));
    const result = await data(client, 'product_details', { product_id: PRODUCT_ID });

    expect(Object.keys(result['specs'] as object).length).toBeLessThanOrEqual(30);
    expect(Object.keys(result['key_specs'] as object).length).toBeLessThanOrEqual(12);
  });
});

describe('errors helper', () => {
  it('builds a NotFound with and without an endpoint', () => {
    const bare = notFound('thing', 'try search_torob');
    expect(bare).toBeInstanceOf(TorobError);
    expect(bare.kind).toBe('NotFound');
    expect(bare.endpoint).toBeUndefined();

    const located = notFound('thing', 'try search_torob', '/v4/x/');
    expect(located.endpoint).toBe('/v4/x/');
    expect(located.detail).toBe('thing');
  });
});

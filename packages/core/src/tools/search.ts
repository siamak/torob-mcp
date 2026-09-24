/**
 * Discovery tools: search_torob, browse_category, find_best_value, search_filters.
 *
 * All four ride one upstream endpoint (/v4/base-product/search/). Filter names are mapped in
 * endpoints.ts rather than passed through, because upstream ignores a wrong parameter name silently
 * instead of erroring.
 */

import { z } from 'zod';
import { argsKey, decodeCursor, encodeCursor } from '../lib/cursor.ts';
import { normalizeQuery } from '../lib/fa.ts';
import { toToman } from '../lib/money.ts';
import { type ProductCard, projectCard } from '../lib/project.ts';
import { FIELD_LIMITS, sanitizeOptional, sanitizeText } from '../lib/sanitize.ts';
import type { Runtime } from '../runtime.ts';
import { request } from '../torob/client.ts';
import * as endpoints from '../torob/endpoints.ts';
import { BrandListResponseSchema, SearchResponseSchema } from '../torob/schemas.ts';
import {
  ConditionInput,
  CursorInput,
  cacheKeyFor,
  LimitInput,
  QueryInput,
  SortInput,
  unwrap,
} from './shared.ts';

/** Upstream caps size at 100; we ask for what the caller wants and no more. */
const UPSTREAM_MAX_SIZE = 100;

export const searchInput = {
  query: QueryInput.optional(),
  category_id: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Narrow to one category (from search_filters).'),
  brand_id: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Narrow to one brand (from search_filters).'),
  price_min_toman: z.number().int().min(0).optional().describe('Lowest acceptable price in Toman.'),
  price_max_toman: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Highest acceptable price in Toman.'),
  condition: ConditionInput.optional(),
  in_stock_only: z.boolean().optional().describe('Only products with an available seller.'),
  sort: SortInput.optional(),
  limit: LimitInput.default(20),
  cursor: CursorInput.optional(),
};

const SearchArgs = z.object(searchInput);
type SearchArgs = z.infer<typeof SearchArgs>;

export interface SearchResult {
  products: ProductCard[];
  /** Torob caps this at 1200 on broad browses, so it is an estimate, not a total. */
  approx_total?: number;
  price_span_toman?: { min?: number; max?: number };
  spelling_correction?: string;
  suggested_categories?: { title: string; category_id: number }[];
  next_cursor?: string;
  note: string;
}

function toUpstreamQuery(args: SearchArgs, page: number, size: number): endpoints.SearchQuery {
  const q: Record<string, unknown> = {
    page,
    size,
  };
  if (args.query !== undefined) q.query = normalizeQuery(args.query);
  if (args.category_id !== undefined) q.category = endpoints.categoryId(args.category_id);
  if (args.brand_id !== undefined) q.brand = endpoints.brandId(args.brand_id);
  if (args.price_min_toman !== undefined) q.priceMinToman = args.price_min_toman;
  if (args.price_max_toman !== undefined) q.priceMaxToman = args.price_max_toman;
  if (args.condition !== undefined) q.condition = args.condition;
  if (args.in_stock_only !== undefined) q.inStockOnly = args.in_stock_only;
  if (args.sort !== undefined) q.sort = args.sort;
  return q as unknown as endpoints.SearchQuery;
}

/**
 * Runs a search page.
 *
 * Upstream pagination is 0-indexed and its `next` URL carries session identifiers, so we never
 * follow it — the cursor holds our own offset and the arguments it is bound to.
 */
export async function runSearch(
  runtime: Runtime,
  args: SearchArgs,
  tool: 'search_torob' | 'browse_category',
): Promise<SearchResult> {
  const { cursor, limit, ...bound } = args;
  const key = await argsKey(bound as Record<string, unknown>);
  const offset = cursor === undefined ? 0 : decodeCursor(cursor, tool, key);

  const size = Math.min(limit, UPSTREAM_MAX_SIZE);
  const page = Math.floor(offset / size);
  const spec = endpoints.search(toUpstreamQuery(args, page, size));

  const response = unwrap(
    await request(runtime, spec, SearchResponseSchema, {
      ttlSeconds: runtime.config.ttl.search,
      cacheKey: await cacheKeyFor({ ...bound, page, size }),
    }),
  );

  const products = response.results.map(projectCard);
  const result: SearchResult = { products, note: buildNote(args) };

  if (typeof response.count === 'number') result.approx_total = response.count;

  const min = toToman(response.min_price);
  const max = toToman(response.max_price);
  if (min !== undefined || max !== undefined) {
    // These describe the unfiltered query — they do not move when price bounds are applied.
    result.price_span_toman = {
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
    };
  }

  const corrected = sanitizeOptional(response.spellcheck?.corrected_query, FIELD_LIMITS.title);
  if (response.spellcheck?.is_spellchecked === true && corrected !== undefined) {
    result.spelling_correction = corrected;
  }

  const cats = (response.categories ?? [])
    .map((c) => ({ title: sanitizeText(c.title, FIELD_LIMITS.name), category_id: c.cat_id }))
    .filter(
      (c): c is { title: string; category_id: number } =>
        c.title.length > 0 && typeof c.category_id === 'number',
    )
    .slice(0, 6);
  if (cats.length > 0) result.suggested_categories = cats;

  if (products.length === size) {
    result.next_cursor = encodeCursor(tool, offset + products.length, key);
  }

  return result;
}

function buildNote(args: SearchArgs): string {
  const parts = ['Prices are in Toman and change constantly.'];
  if (args.price_min_toman !== undefined || args.price_max_toman !== undefined) {
    parts.push('price_span_toman describes the unfiltered query, not your price filter.');
  }
  parts.push('approx_total is Torob’s estimate and caps at 1200 on broad queries.');
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// find_best_value
// ---------------------------------------------------------------------------

export const findBestValueInput = {
  query: QueryInput,
  budget_toman: z
    .number()
    .int()
    .min(1000)
    .describe('The most the user is willing to spend, in Toman.'),
  must_be_new: z.boolean().optional().describe('Exclude used and refurbished listings.'),
  limit: LimitInput.default(10),
};

const BestValueArgs = z.object(findBestValueInput);

export interface ValuePick extends ProductCard {
  /** Local heuristic in 0-100, not a Torob score. */
  value_score: number;
  why: string;
}

/**
 * Ranks search hits against a budget.
 *
 * The ranking is ours and deliberately simple: stay under budget, prefer products with many
 * sellers (a thin listing is a riskier buy), and prefer in-stock new items when asked. `why`
 * states the reasoning so the model can repeat it rather than invent one.
 */
export async function runFindBestValue(
  runtime: Runtime,
  args: z.infer<typeof BestValueArgs>,
): Promise<{ picks: ValuePick[]; budget_toman: number; note: string }> {
  const search = await runSearch(
    runtime,
    {
      query: args.query,
      price_max_toman: args.budget_toman,
      sort: 'most_sellers',
      limit: Math.min(50, args.limit * 3),
      ...(args.must_be_new === true ? { condition: 'new' as const } : {}),
      in_stock_only: true,
    },
    'search_torob',
  );

  const picks = search.products
    .filter((p) => p.price_toman !== undefined && p.price_toman <= args.budget_toman)
    .map((p) => {
      const price = p.price_toman ?? 0;
      const headroom = 1 - price / args.budget_toman;
      const sellers = p.shop_count ?? 1;
      // Price dominates; seller count is a tiebreaker that rewards well-supplied listings.
      const score = Math.round(Math.min(100, headroom * 60 + Math.min(sellers, 20) * 2));
      const reasons = [`${Math.round(headroom * 100)}% under budget`];
      if (sellers > 1) reasons.push(`${sellers} sellers`);
      if (p.condition !== undefined) reasons.push(p.condition);
      return { ...p, value_score: score, why: reasons.join(', ') };
    })
    .sort((a, b) => b.value_score - a.value_score)
    .slice(0, args.limit);

  return {
    picks,
    budget_toman: args.budget_toman,
    note: 'value_score is computed by this server from price headroom and seller count - it is not a Torob rating. Call product_sellers before recommending a specific purchase.',
  };
}

// ---------------------------------------------------------------------------
// search_filters
// ---------------------------------------------------------------------------

export const searchFiltersInput = {
  query: QueryInput.optional(),
  category_id: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Show the filters available in one category.'),
};

export interface FiltersResult {
  categories: { title: string; category_id: number }[];
  brands: { brand_id: number; name_fa?: string; name_en?: string }[];
  price_span_toman?: { min?: number; max?: number };
  sorts: string[];
  facets: { title: string; slug: string; values: string[] }[];
  note: string;
}

export async function runSearchFilters(
  runtime: Runtime,
  args: { query?: string | undefined; category_id?: number | undefined },
): Promise<FiltersResult> {
  const spec = endpoints.search(
    toUpstreamQuery(
      {
        ...(args.query === undefined ? {} : { query: args.query }),
        ...(args.category_id === undefined ? {} : { category_id: args.category_id }),
        limit: 1,
      } as SearchArgs,
      0,
      1,
    ),
  );

  const response = unwrap(
    await request(runtime, spec, SearchResponseSchema, {
      ttlSeconds: runtime.config.ttl.search,
      cacheKey: await cacheKeyFor({ ...args, kind: 'filters' }),
    }),
  );

  const categories = (response.categories ?? [])
    .map((c) => ({ title: sanitizeText(c.title, FIELD_LIMITS.name), category_id: c.cat_id }))
    .filter(
      (c): c is { title: string; category_id: number } =>
        c.title.length > 0 && typeof c.category_id === 'number',
    )
    .slice(0, 12);

  const brands = extractBrands(response.filters1 ?? []).slice(0, 20);

  // filters1 is thin on some queries; the dedicated brand endpoint fills the gap when we have a
  // category to ask about.
  let finalBrands = brands;
  if (finalBrands.length === 0 && args.category_id !== undefined) {
    const listed = await request(
      runtime,
      endpoints.brandList(endpoints.categoryId(args.category_id)),
      BrandListResponseSchema,
      {
        ttlSeconds: runtime.config.ttl.shop,
        cacheKey: await cacheKeyFor({ cat: args.category_id }),
      },
    );
    if (listed.ok) {
      finalBrands = listed.value.map((b) => buildBrand(b.id, b.name1, b.name2)).slice(0, 20);
    }
  }

  const min = toToman(response.min_price);
  const max = toToman(response.max_price);

  const facets = (response.attributes ?? [])
    .map((a) => ({
      title: sanitizeText(a.title, FIELD_LIMITS.name),
      slug: sanitizeText(a.slug, FIELD_LIMITS.name),
      values: extractFacetValues(a.items ?? []),
    }))
    .filter((f) => f.title.length > 0 && f.values.length > 0)
    .slice(0, 10);

  return {
    categories,
    brands: finalBrands,
    ...(min === undefined && max === undefined
      ? {}
      : {
          price_span_toman: {
            ...(min === undefined ? {} : { min }),
            ...(max === undefined ? {} : { max }),
          },
        }),
    sorts: ['popular', 'cheapest', 'priciest', 'newest', 'most_sellers'],
    facets,
    note: 'Pass category_id and brand_id from here into search_torob or browse_category. Facets are informational - only category, brand, price, condition and stock are filterable today.',
  };
}

function buildBrand(
  id: number,
  name1: unknown,
  name2: unknown,
): { brand_id: number; name_fa?: string; name_en?: string } {
  const fa = sanitizeOptional(name1, FIELD_LIMITS.name);
  const en = sanitizeOptional(name2, FIELD_LIMITS.name);
  return {
    brand_id: id,
    ...(fa === undefined ? {} : { name_fa: fa }),
    ...(en === undefined ? {} : { name_en: en }),
  };
}

function extractBrands(
  groups: readonly { slug?: string | null | undefined; items?: unknown[] | null | undefined }[],
): { brand_id: number; name_fa?: string; name_en?: string }[] {
  const group = groups.find((g) => g.slug === 'brand');
  const out: { brand_id: number; name_fa?: string; name_en?: string }[] = [];
  for (const item of group?.items ?? []) {
    if (typeof item !== 'object' || item === null) continue;
    const record: Record<string, unknown> = { ...item };
    const id = record.id;
    if (typeof id !== 'number') continue;
    out.push(buildBrand(id, record.name1, record.name2));
  }
  return out;
}

function extractFacetValues(items: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue;
    const record: Record<string, unknown> = { ...item };
    const label = sanitizeOptional(record.name ?? record.name1 ?? record.value, FIELD_LIMITS.badge);
    if (label !== undefined) out.push(label);
    if (out.length >= 8) break;
  }
  return out;
}

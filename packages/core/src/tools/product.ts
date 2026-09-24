/**
 * Product tools: product_details, product_variants, product_url, get_products_batch,
 * compare_products, similar_products.
 *
 * All but product_url and similar_products ride the one /v4/base-product/details/ response, which
 * is ~247KB upstream and carries specs, variants and the first page of both seller lists. Sharing
 * its cache is what keeps the composite tools inside their subrequest budget.
 */

import { z } from 'zod';
import { parsePersianInt } from '../lib/fa.ts';
import { toToman } from '../lib/money.ts';
import {
  type CategoryStep,
  type ProductCard,
  projectCard,
  projectCategoryPath,
  projectKeySpecs,
  projectSpecs,
} from '../lib/project.ts';
import { FIELD_LIMITS, sanitizeList, sanitizeOptional, sanitizeText } from '../lib/sanitize.ts';
import type { Runtime } from '../runtime.ts';
import { request } from '../torob/client.ts';
import * as endpoints from '../torob/endpoints.ts';
import type { DetailsResponse } from '../torob/schemas.ts';
import { DetailsResponseSchema, SimilarResponseSchema } from '../torob/schemas.ts';
import {
  assertBudget,
  CursorInput,
  cacheKeyFor,
  LimitInput,
  ProductIdInput,
  paginate,
  unwrap,
} from './shared.ts';

/** Fetches (or serves from cache) the details response every product tool builds on. */
export async function fetchDetails(runtime: Runtime, rawId: string): Promise<DetailsResponse> {
  const id = endpoints.productId(rawId);
  return unwrap(
    await request(runtime, endpoints.details(id), DetailsResponseSchema, {
      ttlSeconds: runtime.config.ttl.product,
      cacheKey: cacheKeyFor({ prk: id }),
    }),
  );
}

// ---------------------------------------------------------------------------
// product_details
// ---------------------------------------------------------------------------

export const productDetailsInput = { product_id: ProductIdInput };

export interface ProductDetails {
  product_id: string;
  title_fa: string;
  title_en?: string;
  price_min_toman?: number;
  price_max_toman?: number;
  seller_count?: number;
  in_stock?: boolean;
  condition?: string;
  is_authentic?: boolean;
  category_path: CategoryStep[];
  category_id?: number;
  key_specs: Record<string, string>;
  specs: Record<string, string>;
  badges?: string[];
  url: string;
  note: string;
}

export function projectDetails(details: DetailsResponse): ProductDetails {
  const out: ProductDetails = {
    product_id: details.random_key,
    title_fa: sanitizeText(details.name1, FIELD_LIMITS.title),
    category_path: projectCategoryPath(details),
    key_specs: projectKeySpecs(details),
    specs: projectSpecs(details),
    url: endpoints.productWebUrl(endpoints.productId(details.random_key)),
    note: 'Prices are in Toman. Call product_sellers for individual offers, or product_price_chart to see whether the current price is good.',
  };

  const titleEn = sanitizeOptional(details.name2, FIELD_LIMITS.title);
  if (titleEn !== undefined) out.title_en = titleEn;

  const min = toToman(details.min_price);
  if (min !== undefined) out.price_min_toman = min;
  const max = toToman(details.max_price);
  if (max !== undefined) out.price_max_toman = max;

  const sellers = details.products_info?.count ?? parsePersianInt(details.shop_text);
  if (typeof sellers === 'number') out.seller_count = sellers;

  if (typeof details.availability === 'boolean') out.in_stock = details.availability;
  const condition = sanitizeOptional(details.stock_status, FIELD_LIMITS.badge);
  if (condition !== undefined) out.condition = condition;
  if (details.is_authentic === true) out.is_authentic = true;
  if (typeof details.torob_category === 'number') out.category_id = details.torob_category;

  const badges = sanitizeList(
    (details.badges ?? []).map((b) => b.text),
    FIELD_LIMITS.badge,
    4,
  );
  if (badges.length > 0) out.badges = badges;

  return out;
}

export async function runProductDetails(
  runtime: Runtime,
  productId: string,
): Promise<ProductDetails> {
  return projectDetails(await fetchDetails(runtime, productId));
}

// ---------------------------------------------------------------------------
// product_variants
// ---------------------------------------------------------------------------

export const productVariantsInput = { product_id: ProductIdInput };

export interface VariantGroup {
  title: string;
  variants: { product_id: string; title: string; price_toman?: number; is_current: boolean }[];
}

/**
 * Reads the sibling variants embedded in the details response.
 *
 * Costs no extra request when product_details was called first, because both share one cache entry.
 */
export async function runProductVariants(
  runtime: Runtime,
  productId: string,
): Promise<{ groups: VariantGroup[]; note: string }> {
  const details = await fetchDetails(runtime, productId);
  const current = details.random_key;

  const groups: VariantGroup[] = (details.variants ?? [])
    .map((group) => ({
      title: sanitizeText(group.title, FIELD_LIMITS.name),
      variants: (group.items ?? []).map((item) => {
        const card = projectCard(item);
        return {
          product_id: card.product_id,
          title: card.title_fa,
          ...(card.price_toman === undefined ? {} : { price_toman: card.price_toman }),
          is_current: card.product_id === current,
        };
      }),
    }))
    .filter((g) => g.variants.length > 0);

  return {
    groups,
    note:
      groups.length === 0
        ? 'Torob lists no variants for this product.'
        : 'Each variant has its own product_id - pass it to product_details or product_sellers. Prices shown are that variant’s cheapest offer.',
  };
}

// ---------------------------------------------------------------------------
// product_url
// ---------------------------------------------------------------------------

export const productUrlInput = {
  product_id: ProductIdInput,
  include_title: z
    .boolean()
    .default(false)
    .describe(
      'Also fetch the product title. Costs one request to Torob; leave false for a link alone.',
    ),
};

/**
 * Builds a shareable link.
 *
 * Makes no network call by default: torob.com/p/<uuid>/ redirects to the canonical slug URL, so a
 * validated id is all we need.
 */
export async function runProductUrl(
  runtime: Runtime,
  productId: string,
  includeTitle: boolean,
): Promise<{ url: string; product_id: string; title_fa?: string }> {
  const id = endpoints.productId(productId);
  const url = endpoints.productWebUrl(id);
  if (!includeTitle) return { url, product_id: id };

  const details = await fetchDetails(runtime, id);
  return { url, product_id: id, title_fa: sanitizeText(details.name1, FIELD_LIMITS.title) };
}

// ---------------------------------------------------------------------------
// get_products_batch
// ---------------------------------------------------------------------------

export const getProductsBatchInput = {
  product_ids: z
    .array(ProductIdInput)
    .min(1)
    .max(10)
    .describe('Up to 10 product ids. Each costs one request to Torob.'),
};

/**
 * Fetches cards for several ids.
 *
 * Torob has no batch form — passing prk twice returns only the last one — so this is N requests,
 * declared up front and refused as a whole if over budget.
 */
export async function runGetProductsBatch(
  runtime: Runtime,
  productIds: readonly string[],
): Promise<{ products: ProductCard[]; not_found: string[]; note: string }> {
  assertBudget(runtime, productIds.length, 'get_products_batch');

  const products: ProductCard[] = [];
  const notFound: string[] = [];

  for (const raw of productIds) {
    try {
      const details = await fetchDetails(runtime, raw);
      products.push(detailsToCard(details));
    } catch {
      // One bad id must not lose the other nine.
      notFound.push(raw);
    }
  }

  return {
    products,
    not_found: notFound,
    note: 'Prices are in Toman. Ids in not_found are unknown to Torob or malformed.',
  };
}

function detailsToCard(details: DetailsResponse): ProductCard {
  const card: ProductCard = {
    product_id: details.random_key,
    title_fa: sanitizeText(details.name1, FIELD_LIMITS.title),
    url: endpoints.productWebUrl(endpoints.productId(details.random_key)),
  };
  const titleEn = sanitizeOptional(details.name2, FIELD_LIMITS.title);
  if (titleEn !== undefined) card.title_en = titleEn;
  const price = toToman(details.min_price ?? details.price);
  if (price !== undefined) card.price_toman = price;
  const sellers = details.products_info?.count ?? parsePersianInt(details.shop_text);
  if (typeof sellers === 'number') card.shop_count = sellers;
  const condition = sanitizeOptional(details.stock_status, FIELD_LIMITS.badge);
  if (condition !== undefined) card.condition = condition;
  return card;
}

// ---------------------------------------------------------------------------
// compare_products
// ---------------------------------------------------------------------------

export const compareProductsInput = {
  product_ids: z
    .array(ProductIdInput)
    .min(2)
    .max(5)
    .describe('Two to five product ids to compare. Each costs one request to Torob.'),
};

export interface CompareResult {
  products: ProductDetails[];
  /** Only the specs that actually differ, so the model is not asked to diff 30 identical rows. */
  spec_diff: { spec: string; values: Record<string, string> }[];
  cheapest_id?: string;
  note: string;
}

export async function runCompareProducts(
  runtime: Runtime,
  productIds: readonly string[],
): Promise<CompareResult> {
  assertBudget(runtime, productIds.length, 'compare_products');

  const products: ProductDetails[] = [];
  for (const raw of productIds) products.push(projectDetails(await fetchDetails(runtime, raw)));

  const specKeys = new Set<string>();
  for (const p of products) {
    for (const key of Object.keys({ ...p.key_specs, ...p.specs })) specKeys.add(key);
  }

  const specDiff: { spec: string; values: Record<string, string> }[] = [];
  for (const spec of specKeys) {
    const values: Record<string, string> = {};
    for (const p of products) values[p.product_id] = p.key_specs[spec] ?? p.specs[spec] ?? '-';
    const distinct = new Set(Object.values(values));
    if (distinct.size > 1) specDiff.push({ spec, values });
    if (specDiff.length >= 20) break;
  }

  const priced = products.filter((p) => p.price_min_toman !== undefined);
  const cheapest = priced.sort((a, b) => (a.price_min_toman ?? 0) - (b.price_min_toman ?? 0))[0];

  return {
    products,
    spec_diff: specDiff,
    ...(cheapest === undefined ? {} : { cheapest_id: cheapest.product_id }),
    note: 'spec_diff lists only specs that differ between these products. cheapest_id compares each product’s lowest current offer.',
  };
}

// ---------------------------------------------------------------------------
// similar_products
// ---------------------------------------------------------------------------

export const similarProductsInput = {
  product_id: ProductIdInput,
  limit: LimitInput.default(10),
  cursor: CursorInput.optional(),
};

/**
 * Torob's own "similar products" list.
 *
 * Upstream ignores its `limit` parameter and returns the whole list, so paging happens locally over
 * one cached response.
 */
export async function runSimilarProducts(
  runtime: Runtime,
  args: { product_id: string; limit: number; cursor?: string | undefined },
): Promise<{ products: ProductCard[]; next_cursor?: string; note: string }> {
  const id = endpoints.productId(args.product_id);
  const response = unwrap(
    await request(runtime, endpoints.similar(id), SimilarResponseSchema, {
      ttlSeconds: runtime.config.ttl.search,
      cacheKey: cacheKeyFor({ prk: id }),
    }),
  );

  const all = response.results.map(projectCard);
  const page = paginate(all, 'similar_products', { product_id: id }, args.limit, args.cursor);

  return {
    products: page.items,
    ...(page.next_cursor === undefined ? {} : { next_cursor: page.next_cursor }),
    note: 'Similarity is Torob’s own ranking. Prices are in Toman.',
  };
}

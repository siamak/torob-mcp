/**
 * URL construction.
 *
 * There is no code path from a raw string to a URL. Ids arrive as branded types that can only be
 * produced by the validators below, and free text is only ever placed into URLSearchParams — never
 * concatenated into a path. This is the structural half of the SSRF defence; the host allowlist in
 * client.ts is the other half.
 */

import { TorobError } from './errors.ts';

export const API_HOST = 'api.torob.com';
export const WEB_HOST = 'torob.com';

/** The complete allowlist. Frozen, checked on every request and on every redirect hop. */
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set([API_HOST, WEB_HOST]);

declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

export type ProductId = Brand<string, 'ProductId'>;
export type ShopId = Brand<number, 'ShopId'>;
export type CategoryId = Brand<number, 'CategoryId'>;
export type BrandId = Brand<number, 'BrandId'>;
export type CityId = Brand<number, 'CityId'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates a product id before any URL exists.
 *
 * This is what keeps us from ever issuing the request that returns `{"random_key":"not-a-uuid"}`
 * under a 404 — a 200-shaped body that would otherwise partially satisfy a product schema.
 */
export function productId(value: string): ProductId {
  if (!UUID.test(value)) {
    throw new TorobError('NotFound', {
      hint: 'that is not a Torob product id - call search_torob first and use the product_id it returns',
      detail: 'product id failed uuid validation',
    });
  }
  return value.toLowerCase() as ProductId;
}

function positiveInt<T extends number>(value: number, what: string, hint: string): T {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TorobError('NotFound', { hint, detail: `${what} failed integer validation` });
  }
  return value as T;
}

export const shopId = (value: number): ShopId =>
  positiveInt<ShopId>(value, 'shop id', 'that is not a Torob shop id - shop_id comes from product_sellers');

export const categoryId = (value: number): CategoryId =>
  positiveInt<CategoryId>(
    value,
    'category id',
    'that is not a Torob category id - call search_filters to discover category ids',
  );

export const brandId = (value: number): BrandId =>
  positiveInt<BrandId>(
    value,
    'brand id',
    'that is not a Torob brand id - call search_filters to discover brand ids',
  );

export const cityId = (value: number): CityId =>
  positiveInt<CityId>(value, 'city id', 'that is not a Torob city id');

export interface EndpointSpec {
  readonly url: URL;
  /** Path only, for logs and errors — the query may contain the user's search text. */
  readonly label: string;
  /** Derived request headers. Only product_stores uses this, for deliver_city. */
  readonly headers?: Readonly<Record<string, string>>;
}

type QueryValue = string | number | boolean | undefined;

function api(path: string, query: Record<string, QueryValue> = {}): EndpointSpec {
  const url = new URL(`https://${API_HOST}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return { url, label: path };
}

/**
 * Sort values as Torob spells them, mapped from our enum.
 * Source: the `filters2[slug=sort]` block in docs/ENDPOINTS.md.
 */
export const SORT_MAP = {
  popular: '',
  cheapest: 'price',
  priciest: '-price',
  newest: '-date',
  most_sellers: '-supply',
} as const;
export type SortKey = keyof typeof SORT_MAP;

export interface SearchQuery {
  readonly query?: string;
  readonly category?: CategoryId;
  readonly brand?: BrandId;
  readonly priceMinToman?: number;
  readonly priceMaxToman?: number;
  readonly condition?: 'new' | 'used';
  readonly inStockOnly?: boolean;
  readonly sort?: SortKey;
  readonly page: number;
  readonly size: number;
}

export function search(q: SearchQuery): EndpointSpec {
  const sort = q.sort === undefined ? undefined : SORT_MAP[q.sort];
  return api('/v4/base-product/search/', {
    q: q.query,
    // Singular. `brands=` is silently ignored upstream, which is why every filter has a test
    // asserting the result set actually narrowed.
    category: q.category,
    brand: q.brand,
    price__gt: q.priceMinToman,
    price__lt: q.priceMaxToman,
    stock_status: q.condition === undefined ? undefined : q.condition === 'new' ? 'new' : 'stock',
    available: q.inStockOnly === true ? 'true' : undefined,
    sort: sort === '' ? undefined : sort,
    page: q.page,
    size: q.size,
  });
}

/** Note the missing /v4 — this route hangs off the API root. */
export const suggestion = (query: string): EndpointSpec => {
  const url = new URL(`https://${API_HOST}/suggestion2/`);
  url.searchParams.set('q', query);
  url.searchParams.set('source', 'next');
  return { url, label: '/suggestion2/' };
};

export const details = (id: ProductId): EndpointSpec =>
  api('/v4/base-product/details/', { prk: id });

export const sellers = (id: ProductId, kind: 'online' | 'in_store', city?: CityId): EndpointSpec => {
  const spec = api('/v4/base-product/sellers/', {
    prk: id,
    list_type: kind === 'online' ? 'products_info' : 'products_in_store_info',
  });
  // Upstream filters by city through a cookie, not a query param (docs/ENDPOINTS.md).
  // This value is computed from the tool's own argument; no cookie jar exists and no set-cookie
  // is ever read. See docs/PRIVACY.md.
  return city === undefined ? spec : { ...spec, headers: { cookie: `deliver_city=${city}` } };
};

export const priceChart = (id: ProductId): EndpointSpec =>
  api('/v4/base-product/price-chart/', { prk: id });

export const similar = (id: ProductId): EndpointSpec =>
  api('/v4/base-product/similar-base-product/', { prk: id });

/** The parameter is `id`; `shop_id` returns 400. */
export const shop = (id: ShopId): EndpointSpec => api('/v4/internet-shop/details/', { id });

export const cityList = (nameQuery: string): EndpointSpec =>
  api('/v4/city/list/', { search: nameQuery, size: 100 });

export const brandList = (category: CategoryId): EndpointSpec =>
  api('/v4/brand/list/', { cat_list: category });

/**
 * The canonical product URL.
 *
 * `https://torob.com/p/<uuid>/` 301s to the slug form, so product_url costs zero upstream requests.
 */
export const productWebUrl = (id: ProductId): string => `https://${WEB_HOST}/p/${id}/`;

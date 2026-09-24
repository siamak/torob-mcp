/**
 * Zod schemas for every upstream response, pinned by the fixtures in fixtures/.
 *
 * Discipline (docs/ARCHITECTURE.md): containers are loose about fields we do not read — Torob
 * adding a field is noise, not drift — but every field we *depend on* is typed, so a change in its
 * type fails loudly as SchemaDrift rather than producing confidently wrong prices.
 *
 * Nothing here is `any` and nothing is `as`-cast.
 */

import { z } from 'zod';

/** `price` is an integer on cards and seller rows; `min_price`/`max_price` arrive as floats. */
const Money = z.number();

const Badge = z
  .object({
    text: z.string().nullish(),
    badge_type: z.string().nullish(),
  })
  .loose();

/**
 * The card shape, shared by search, browse, similar, and the variant siblings embedded in details.
 *
 * `name1`/`name2` are merchant-authored and are the primary injection surface — every consumer
 * routes them through lib/sanitize.ts.
 */
export const CardSchema = z
  .object({
    random_key: z.string(),
    name1: z.string().nullish(),
    name2: z.string().nullish(),
    price: Money.nullish(),
    price_text: z.string().nullish(),
    shop_text: z.string().nullish(),
    stock_status: z.string().nullish(),
    web_client_absolute_url: z.string().nullish(),
    is_adv: z.boolean().nullish(),
    badges: z.array(Badge).nullish(),
    has_nearby_shop: z.boolean().nullish(),
    is_authentic: z.boolean().nullish(),
  })
  .loose();
export type Card = z.infer<typeof CardSchema>;

const CategoryRef = z
  .object({
    title: z.string().nullish(),
    cat_id: z.number().nullish(),
  })
  .loose();

const BrandRef = z
  .object({
    id: z.number(),
    name1: z.string().nullish(),
    name2: z.string().nullish(),
  })
  .loose();

const FilterGroup = z
  .object({
    title: z.string().nullish(),
    slug: z.string().nullish(),
    type: z.string().nullish(),
    items: z.array(z.unknown()).nullish(),
  })
  .loose();

export const SearchResponseSchema = z
  .object({
    results: z.array(CardSchema),
    count: z.number().nullish(),
    min_price: Money.nullish(),
    max_price: Money.nullish(),
    spellcheck: z
      .object({
        is_spellchecked: z.boolean().nullish(),
        initial_query: z.string().nullish(),
        corrected_query: z.string().nullish(),
      })
      .loose()
      .nullish(),
    categories: z.array(CategoryRef).nullish(),
    parent_categories: z.array(CategoryRef).nullish(),
    category_is_leaf: z.boolean().nullish(),
    filters1: z.array(FilterGroup).nullish(),
    filters2: z.array(FilterGroup).nullish(),
    attributes: z.array(FilterGroup).nullish(),
  })
  .loose();
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

/** `GET /suggestion2/` returns a bare array — note the missing /v4 prefix on that route. */
export const SuggestionResponseSchema = z.array(
  z
    .object({
      text: z.string(),
      is_history: z.boolean().nullish(),
    })
    .loose(),
);

const ScoreInfo = z
  .object({
    score: z.number().nullish(),
    score_text: z.string().nullish(),
    complaints_info: z
      .object({
        title: z.string().nullish(),
        summary: z.array(z.string()).nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

export const SellerSchema = z
  .object({
    prk: z.string().nullish(),
    shop_id: z.number().nullish(),
    shop_name: z.string().nullish(),
    shop_name2: z.string().nullish(),
    name1: z.string().nullish(),
    name2: z.string().nullish(),
    price: Money.nullish(),
    price_text: z.string().nullish(),
    availability: z.boolean().nullish(),
    is_price_unreliable: z.boolean().nullish(),
    shop_score: z.number().nullish(),
    shop_score_percentile: z.number().nullish(),
    shop_votes_count: z.number().nullish(),
    score_info: ScoreInfo.nullish(),
    last_price_change_date: z.string().nullish(),
    has_public_torob_profile: z.boolean().nullish(),
    guarantee_info: z.object({ status: z.string().nullish() }).loose().nullish(),
    installment: z.unknown().nullish(),
    is_filtered_by_bnpl: z.boolean().nullish(),
    is_filtered_by_torobpay: z.boolean().nullish(),
    badges: z.array(Badge).nullish(),
    more_info: z
      .object({
        free_shipping: z.unknown().nullish(),
        payment_on_delivery: z.unknown().nullish(),
        same_day_delivery: z.string().nullish(),
        shipping_types: z.array(z.string()).nullish(),
      })
      .loose()
      .nullish(),
    // physical-store rows only
    is_open: z.boolean().nullish(),
    supports_fast_delivery: z.boolean().nullish(),
    working_hours: z
      .object({
        title: z
          .object({ status: z.string().nullish(), text: z.string().nullish() })
          .loose()
          .nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();
export type Seller = z.infer<typeof SellerSchema>;

/** The sellers endpoint ignores page/size and returns the whole list every time. */
export const SellersResponseSchema = z
  .object({
    results: z.array(SellerSchema),
    count: z.number().nullish(),
  })
  .loose();

const SellerList = z
  .object({
    result: z.array(SellerSchema).nullish(),
    count: z.number().nullish(),
  })
  .loose();

export const DetailsResponseSchema = z
  .object({
    random_key: z.string(),
    name1: z.string().nullish(),
    name2: z.string().nullish(),
    price: Money.nullish(),
    price_text: z.string().nullish(),
    min_price: Money.nullish(),
    max_price: Money.nullish(),
    shop_text: z.string().nullish(),
    stock_status: z.string().nullish(),
    web_client_absolute_url: z.string().nullish(),
    slug_name: z.string().nullish(),
    is_authentic: z.boolean().nullish(),
    availability: z.boolean().nullish(),
    torob_category: z.number().nullish(),
    badges: z.array(Badge).nullish(),
    breadcrumbs: z
      .array(
        z
          .object({
            title: z.string().nullish(),
            cat_id: z.number().nullish(),
            brand_id: z.number().nullish(),
          })
          .loose(),
      )
      .nullish(),
    key_specs: z
      .array(
        z
          .object({
            header: z.string().nullish(),
            items: z
              .array(
                z
                  .object({
                    key: z.string().nullish(),
                    value: z.array(z.string()).nullish(),
                  })
                  .loose(),
              )
              .nullish(),
          })
          .loose(),
      )
      .nullish(),
    structural_specs: z
      .object({
        headers: z
          .array(
            z
              .object({
                header: z.string().nullish(),
                specs: z.record(z.string(), z.unknown()).nullish(),
              })
              .loose(),
          )
          .nullish(),
      })
      .loose()
      .nullish(),
    variants: z
      .array(
        z
          .object({
            title: z.string().nullish(),
            items: z.array(CardSchema).nullish(),
          })
          .loose(),
      )
      .nullish(),
    products_info: SellerList.nullish(),
    products_in_store_info: SellerList.nullish(),
  })
  .loose();
export type DetailsResponse = z.infer<typeof DetailsResponseSchema>;

/**
 * Price chart: 52 weekly points with Jalali labels and two sparse series keyed by `i`.
 * Series are joined on `i`, never zipped by position.
 */
export const PriceChartResponseSchema = z
  .object({
    labels: z.array(z.string()),
    dataSets: z.array(
      z
        .object({
          label: z.string().nullish(),
          entries: z.array(z.object({ val: Money, i: z.number() }).loose()),
        })
        .loose(),
    ),
  })
  .loose();

export const SimilarResponseSchema = z
  .object({
    results: z.array(CardSchema),
    count: z.number().nullish(),
  })
  .loose();

/**
 * Shop profile.
 *
 * Upstream returns 72 fields including merchant billing internals and contact PII. This schema
 * describes only what we are willing to read; everything else is left unmodelled and dropped at
 * the projection boundary, so a new upstream field is invisible by default.
 */
export const ShopResponseSchema = z
  .object({
    id: z.number(),
    name: z.string().nullish(),
    city: z.string().nullish(),
    province: z.string().nullish(),
    shop_type: z.string().nullish(),
    shop_score: z.number().nullish(),
    score_percentile: z.number().nullish(),
    score_info: z.array(z.string()).nullish(),
    upvotes: z.number().nullish(),
    downvotes: z.number().nullish(),
    enamad_level: z.string().nullish(),
    enamad_expire_date: z.string().nullish(),
    licenses: z
      .array(
        z
          .object({
            title: z.string().nullish(),
            description_1: z.string().nullish(),
            description_2: z.string().nullish(),
          })
          .loose(),
      )
      .nullish(),
    block_status: z.string().nullish(),
    block_description: z.string().nullish(),
    active_time: z.string().nullish(),
    date_added: z.string().nullish(),
    last_updated: z.string().nullish(),
    domain: z.string().nullish(),
    is_marketplace: z.boolean().nullish(),
    additional_infos: z
      .array(z.object({ title: z.string().nullish(), text: z.string().nullish() }).loose())
      .nullish(),
  })
  .loose();

export const CityListResponseSchema = z
  .object({
    count: z.number().nullish(),
    results: z.array(z.object({ id: z.number(), name: z.string() }).loose()),
  })
  .loose();

export const BrandListResponseSchema = z.array(BrandRef);

/**
 * Upstream error bodies.
 *
 * Three distinct shapes, all delivered under HTTP 404 (docs/ENDPOINTS.md). Parsed by this union so
 * an unrecognised body classifies as Upstream rather than SchemaDrift.
 */
export const ErrorBodySchema = z.union([
  z.object({ message: z.string() }).loose(),
  z.object({ error: z.object({ message: z.string() }).loose() }).loose(),
  z.object({ random_key: z.string() }).loose(),
]);

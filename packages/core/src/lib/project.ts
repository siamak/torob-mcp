/**
 * Projections from upstream shapes to the compact output the model sees.
 *
 * This is the boundary where third-party text is sanitized, prices are normalized to Toman, and
 * tracking fields, image URLs and layout hints are dropped. Nothing upstream reaches a tool result
 * without passing through here.
 */

import type { Card, DetailsResponse, Seller } from '../torob/schemas.ts';
import { parsePersianInt } from './fa.ts';
import { toToman } from './money.ts';
import { FIELD_LIMITS, sanitizeList, sanitizeOptional, sanitizeText } from './sanitize.ts';

export interface ProductCard {
  product_id: string;
  title_fa: string;
  title_en?: string;
  price_toman?: number;
  shop_count?: number;
  condition?: string;
  url: string;
  /** Torob placed this listing as a paid advertisement. Always surfaced, never hidden. */
  sponsored?: boolean;
  badges?: string[];
  has_local_seller?: boolean;
}

const WEB_BASE = 'https://torob.com';

function absoluteUrl(path: unknown, productId: string): string {
  if (typeof path === 'string' && path.startsWith('/')) return `${WEB_BASE}${path}`;
  return `${WEB_BASE}/p/${productId}/`;
}

export function projectCard(card: Card): ProductCard {
  const out: ProductCard = {
    product_id: card.random_key,
    title_fa: sanitizeText(card.name1, FIELD_LIMITS.title),
    url: absoluteUrl(card.web_client_absolute_url, card.random_key),
  };

  const titleEn = sanitizeOptional(card.name2, FIELD_LIMITS.title);
  if (titleEn !== undefined) out.title_en = titleEn;

  const price = toToman(card.price);
  if (price !== undefined) out.price_toman = price;

  // "در ۱۱ فروشگاه" -> 11
  const shops = parsePersianInt(card.shop_text);
  if (shops !== undefined) out.shop_count = shops;

  const condition = sanitizeOptional(card.stock_status, FIELD_LIMITS.badge);
  if (condition !== undefined) out.condition = condition;

  if (card.is_adv === true) out.sponsored = true;
  if (card.has_nearby_shop === true) out.has_local_seller = true;

  const badges = sanitizeList(
    (card.badges ?? []).map((b) => b.text),
    FIELD_LIMITS.badge,
    4,
  );
  if (badges.length > 0) out.badges = badges;

  return out;
}

export interface SellerOffer {
  shop_id?: number;
  shop_name: string;
  shop_city?: string;
  price_toman?: number;
  in_stock?: boolean;
  /** Torob's own flag that a listed price is not to be trusted. Surfaced, never hidden. */
  price_unreliable?: boolean;
  trust: {
    score?: number;
    percentile?: number;
    /** Persian sentences written by Torob about this shop's order history. */
    summary?: string[];
  };
  price_updated?: string;
  torob_warranty?: boolean;
  installment_available?: boolean;
  has_torob_profile?: boolean;
  shipping?: string[];
  listing_title?: string;
  listing_note?: string;
}

export function projectSeller(seller: Seller): SellerOffer {
  const out: SellerOffer = {
    shop_name: sanitizeText(seller.shop_name, FIELD_LIMITS.name),
    trust: {},
  };

  if (typeof seller.shop_id === 'number') out.shop_id = seller.shop_id;

  const city = sanitizeOptional(seller.shop_name2, FIELD_LIMITS.name);
  if (city !== undefined) out.shop_city = city;

  const price = toToman(seller.price);
  if (price !== undefined) out.price_toman = price;

  if (typeof seller.availability === 'boolean') out.in_stock = seller.availability;
  if (seller.is_price_unreliable === true) out.price_unreliable = true;

  if (typeof seller.shop_score === 'number') out.trust.score = seller.shop_score;
  if (typeof seller.shop_score_percentile === 'number' && seller.shop_score_percentile > 0) {
    out.trust.percentile = seller.shop_score_percentile;
  }
  const summary = sanitizeList(
    seller.score_info?.complaints_info?.summary ?? [],
    FIELD_LIMITS.sentence,
    3,
  );
  if (summary.length > 0) out.trust.summary = summary;

  // Relative Persian text ("۶ ساعت پیش"), not a timestamp — kept as the string it is.
  const updated = sanitizeOptional(seller.last_price_change_date, FIELD_LIMITS.badge);
  if (updated !== undefined) out.price_updated = updated;

  if (seller.guarantee_info?.status === 'enabled') out.torob_warranty = true;
  if (seller.is_filtered_by_bnpl === true || seller.is_filtered_by_torobpay === true) {
    out.installment_available = true;
  }
  if (seller.has_public_torob_profile === true) out.has_torob_profile = true;

  const shipping = sanitizeList(seller.more_info?.shipping_types ?? [], FIELD_LIMITS.badge, 4);
  if (shipping.length > 0) out.shipping = shipping;

  // The most injection-prone strings in the whole API: merchant-authored, free-form.
  const listingTitle = sanitizeOptional(seller.name1, FIELD_LIMITS.title);
  if (listingTitle !== undefined) out.listing_title = listingTitle;
  const listingNote = sanitizeOptional(seller.name2, FIELD_LIMITS.note);
  if (listingNote !== undefined) out.listing_note = listingNote;

  return out;
}

export interface StoreOffer extends SellerOffer {
  is_open?: boolean;
  hours_today?: string;
  fast_delivery?: boolean;
}

export function projectStore(seller: Seller): StoreOffer {
  const out: StoreOffer = projectSeller(seller);
  if (typeof seller.is_open === 'boolean') out.is_open = seller.is_open;
  if (seller.supports_fast_delivery === true) out.fast_delivery = true;

  const status = sanitizeOptional(seller.working_hours?.title?.status, FIELD_LIMITS.badge);
  const text = sanitizeOptional(seller.working_hours?.title?.text, FIELD_LIMITS.badge);
  const hours = [status, text].filter((v): v is string => v !== undefined).join(' ');
  if (hours.length > 0) out.hours_today = hours;

  return out;
}

/**
 * Ranks offers cheapest-reliable-first.
 *
 * Upstream already sorts by price alone, which puts unreliable and out-of-stock listings at the
 * top. This re-rank is local and deterministic: it keeps price dominant but demotes listings Torob
 * itself flags as unreliable or unavailable, and breaks ties on shop score.
 */
export function rankOffers<T extends SellerOffer>(offers: readonly T[]): T[] {
  const penalty = (o: T): number => {
    let p = 0;
    if (o.price_unreliable === true) p += 2;
    if (o.in_stock === false) p += 1;
    return p;
  };
  return [...offers].sort((a, b) => {
    const byPenalty = penalty(a) - penalty(b);
    if (byPenalty !== 0) return byPenalty;
    const priceA = a.price_toman ?? Number.MAX_SAFE_INTEGER;
    const priceB = b.price_toman ?? Number.MAX_SAFE_INTEGER;
    if (priceA !== priceB) return priceA - priceB;
    return (b.trust.score ?? 0) - (a.trust.score ?? 0);
  });
}

export interface CategoryStep {
  title: string;
  category_id?: number;
  brand_id?: number;
}

/**
 * Builds the category path from breadcrumbs.
 *
 * The first entry is always the site root (`cat_id: 0`) and is dropped; the last entry may be a
 * brand rather than a category, which is why brand_id is carried through.
 */
export function projectCategoryPath(details: DetailsResponse): CategoryStep[] {
  const crumbs = details.breadcrumbs ?? [];
  const out: CategoryStep[] = [];
  for (const crumb of crumbs) {
    const title = sanitizeText(crumb.title, FIELD_LIMITS.name);
    if (title.length === 0) continue;
    if (crumb.cat_id === 0 && crumb.brand_id === null) continue;
    const step: CategoryStep = { title };
    if (typeof crumb.cat_id === 'number' && crumb.cat_id > 0) step.category_id = crumb.cat_id;
    if (typeof crumb.brand_id === 'number' && crumb.brand_id > 0) step.brand_id = crumb.brand_id;
    out.push(step);
  }
  return out;
}

export function projectKeySpecs(details: DetailsResponse): Record<string, string> {
  const out: Record<string, string> = {};
  for (const group of details.key_specs ?? []) {
    for (const item of group.items ?? []) {
      const key = sanitizeText(item.key, FIELD_LIMITS.name);
      const value = sanitizeList(item.value ?? [], FIELD_LIMITS.badge, 3).join(', ');
      if (key.length > 0 && value.length > 0) out[key] = value;
      if (Object.keys(out).length >= 12) return out;
    }
  }
  return out;
}

/** Full spec table, capped so a details response cannot blow past the output budget. */
export function projectSpecs(details: DetailsResponse, maxEntries = 30): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of details.structural_specs?.headers ?? []) {
    for (const [key, value] of Object.entries(header.specs ?? {})) {
      if (Object.keys(out).length >= maxEntries) return out;
      const cleanKey = sanitizeText(key, FIELD_LIMITS.name);
      const cleanValue = sanitizeText(
        typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : '',
        FIELD_LIMITS.badge,
      );
      if (cleanKey.length > 0 && cleanValue.length > 0) out[cleanKey] = cleanValue;
    }
  }
  return out;
}

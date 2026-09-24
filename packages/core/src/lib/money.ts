/**
 * Money normalization.
 *
 * Torob reports prices in Toman (verified in docs/ENDPOINTS.md against the Persian-digit
 * `price_text` on both cards and seller rows, and against `shop.price_unit_str: "ir_toman"`).
 * No conversion is applied — but the assumption is asserted, not trusted: `assertTomanConsistency`
 * backs the contract test that would catch a silent switch to Rial.
 */

import { parsePersianInt } from './fa.ts';

/**
 * Normalizes an upstream price to an integer number of Toman.
 *
 * `price` arrives as an integer on cards and seller rows but as a float on search's
 * `min_price`/`max_price` (`18000.0`), so rounding happens here rather than in each projection.
 * Zero and negatives mean "no price available" upstream and become undefined.
 */
export function toToman(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value);
}

/**
 * Checks a numeric price against the human-readable string beside it.
 *
 * Used by contract tests over the fixtures: if Torob ever starts reporting Rial in `price` while
 * `price_text` still says Toman, the two stop matching and the suite fails loudly rather than the
 * server reporting prices that are 10x wrong.
 */
export function assertTomanConsistency(price: unknown, priceText: unknown): boolean {
  const numeric = toToman(price);
  const parsed = parsePersianInt(typeof priceText === 'string' ? priceText : undefined);
  if (numeric === undefined || parsed === undefined) return true; // nothing to compare
  return numeric === parsed;
}

/** Formats a Toman amount for the one place we emit prose: price-chart verdict reasons. */
export function formatToman(value: number): string {
  return `${value.toLocaleString('en-US')} Toman`;
}

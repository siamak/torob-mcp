/**
 * Interpretation tools: product_price_chart and torob_suggest.
 *
 * Both do work upstream does not: the chart verdict and the query expansion are computed here, so
 * the model gets an answer rather than a table to interpret.
 */

import { normalizeQuery, parseJalaliLabel } from '../lib/fa.ts';
import { formatToman, toToman } from '../lib/money.ts';
import { FIELD_LIMITS, sanitizeOptional } from '../lib/sanitize.ts';
import type { Runtime } from '../runtime.ts';
import { request } from '../torob/client.ts';
import * as endpoints from '../torob/endpoints.ts';
import {
  PriceChartResponseSchema,
  SearchResponseSchema,
  SuggestionResponseSchema,
} from '../torob/schemas.ts';
import { fetchDetails } from './product.ts';
import { cacheKeyFor, ProductIdInput, QueryInput, unwrap } from './shared.ts';

// ---------------------------------------------------------------------------
// product_price_chart
// ---------------------------------------------------------------------------

export const priceChartInput = { product_id: ProductIdInput };

export interface PricePoint {
  date_iso?: string;
  date_jalali: string;
  min_toman?: number;
  avg_toman?: number;
}

export interface PriceChartResult {
  points: PricePoint[];
  current_min_toman?: number;
  verdict: 'great' | 'fair' | 'high' | 'unknown';
  verdict_reason: string;
  window: string;
  note: string;
}

/** Torob labels its two series in Persian; matched here rather than by array position. */
const AVG_LABEL = 'میانگین'; // میانگین
const MIN_LABEL = 'کمترین'; // کمترین

/**
 * Roughly a year of weekly prices, plus a verdict on the current one.
 *
 * Costs two requests: the chart itself, and details for the current cheapest offer, which the
 * chart response does not carry. Series are sparse and are joined on `entries[].i`, never zipped by
 * position.
 */
export async function runPriceChart(runtime: Runtime, rawId: string): Promise<PriceChartResult> {
  const id = endpoints.productId(rawId);

  const chart = unwrap(
    await request(runtime, endpoints.priceChart(id), PriceChartResponseSchema, {
      ttlSeconds: runtime.config.ttl.priceChart,
      cacheKey: await cacheKeyFor({ prk: id }),
    }),
  );

  const minSeries = new Map<number, number>();
  const avgSeries = new Map<number, number>();
  for (const set of chart.dataSets) {
    const label = set.label ?? '';
    const target = label.includes(MIN_LABEL)
      ? minSeries
      : label.includes(AVG_LABEL)
        ? avgSeries
        : undefined;
    if (target === undefined) continue;
    for (const entry of set.entries) {
      const value = toToman(entry.val);
      if (value !== undefined) target.set(entry.i, value);
    }
  }

  const points: PricePoint[] = chart.labels.map((label, index) => {
    const iso = parseJalaliLabel(label);
    const min = minSeries.get(index);
    const avg = avgSeries.get(index);
    return {
      ...(iso === undefined ? {} : { date_iso: iso }),
      date_jalali: label,
      ...(min === undefined ? {} : { min_toman: min }),
      ...(avg === undefined ? {} : { avg_toman: avg }),
    };
  });

  const details = await fetchDetails(runtime, id);
  const current = toToman(details.min_price);
  const verdict = judge(points, current);

  const first = points[0]?.date_iso ?? points[0]?.date_jalali ?? 'unknown';
  const last =
    points[points.length - 1]?.date_iso ?? points[points.length - 1]?.date_jalali ?? 'unknown';

  return {
    points,
    ...(current === undefined ? {} : { current_min_toman: current }),
    verdict: verdict.verdict,
    verdict_reason: verdict.reason,
    window: `${first} to ${last}, ${points.length} weekly points`,
    note: 'Prices are in Toman, nominal and not inflation-adjusted - in a high-inflation market an old low price is not a price you can get today. The verdict is computed by this server from the last 12 weeks, not by Torob.',
  };
}

/**
 * Compares the current cheapest price against the recent minimum series.
 *
 * Deliberately narrow: only the last 12 points, because Iranian prices inflate fast enough that a
 * two-year-old low is not a meaningful comparison.
 */
function judge(
  points: readonly PricePoint[],
  current: number | undefined,
): { verdict: PriceChartResult['verdict']; reason: string } {
  const recent = points
    .slice(-12)
    .map((p) => p.min_toman)
    .filter((v): v is number => v !== undefined)
    .sort((a, b) => a - b);

  if (current === undefined || recent.length < 4) {
    return {
      verdict: 'unknown',
      reason: 'not enough recent price history to judge the current price',
    };
  }

  const at = (q: number): number =>
    recent[Math.min(recent.length - 1, Math.floor(recent.length * q))] as number;
  const p25 = at(0.25);
  const p75 = at(0.75);
  const low = recent[0] as number;
  const high = recent[recent.length - 1] as number;

  if (current <= p25) {
    return {
      verdict: 'great',
      reason: `${formatToman(current)} is at or below the 25th percentile of the last ${recent.length} weeks (low ${formatToman(low)}, high ${formatToman(high)})`,
    };
  }
  if (current >= p75) {
    return {
      verdict: 'high',
      reason: `${formatToman(current)} is at or above the 75th percentile of the last ${recent.length} weeks (low ${formatToman(low)}, high ${formatToman(high)})`,
    };
  }
  return {
    verdict: 'fair',
    reason: `${formatToman(current)} sits mid-range for the last ${recent.length} weeks (low ${formatToman(low)}, high ${formatToman(high)})`,
  };
}

// ---------------------------------------------------------------------------
// torob_suggest
// ---------------------------------------------------------------------------

export const suggestInput = { query: QueryInput };

/**
 * Turns a vague, misspelled or Finglish query into phrases that actually work.
 *
 * Two sources, two requests: Torob's own autocomplete (which already handles Finglish - "ayfon"
 * returns real completions) and the spellcheck block from a minimal search, which is what catches
 * genuine misspellings.
 */
export async function runSuggest(
  runtime: Runtime,
  rawQuery: string,
): Promise<{ suggestions: string[]; spelling_correction?: string; note: string }> {
  const normalized = normalizeQuery(rawQuery);

  const suggestions = await request(
    runtime,
    endpoints.suggestion(normalized),
    SuggestionResponseSchema,
    { ttlSeconds: runtime.config.ttl.search, cacheKey: await cacheKeyFor({ q: normalized }) },
  );

  const search = await request(
    runtime,
    endpoints.search({ query: normalized, page: 0, size: 1 }),
    SearchResponseSchema,
    {
      ttlSeconds: runtime.config.ttl.search,
      cacheKey: await cacheKeyFor({ q: normalized, size: 1 }),
    },
  );

  const texts: string[] = [];
  if (suggestions.ok) {
    for (const item of suggestions.value) {
      const text = sanitizeOptional(item.text, FIELD_LIMITS.title);
      if (text !== undefined && !texts.includes(text)) texts.push(text);
      if (texts.length >= 8) break;
    }
  }

  const corrected =
    search.ok && search.value.spellcheck?.is_spellchecked === true
      ? sanitizeOptional(search.value.spellcheck.corrected_query, FIELD_LIMITS.title)
      : undefined;

  // Both upstream calls failing is worth reporting; one failing is not.
  if (!suggestions.ok && !search.ok) throw suggestions.error;

  return {
    suggestions: texts,
    ...(corrected === undefined ? {} : { spelling_correction: corrected }),
    note: 'Pass one of these to search_torob. Torob’s autocomplete handles Finglish transliteration, so a Latin-script query often returns usable Persian results directly.',
  };
}

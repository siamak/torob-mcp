/**
 * Environment parsing.
 *
 * Validated with zod at startup and failing fast with every bad key listed at once, so an operator
 * fixes one message rather than discovering problems one restart at a time.
 */

import { SERVER_VERSION } from '@torob-mcp/core';
import { z } from 'zod';

const intFromEnv = (min: number, max: number, fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    v === undefined || v.trim() === ''
      ? []
      : v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
  );

const EnvSchema = z.object({
  TOROB_LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).default('info'),
  TOROB_USER_AGENT: z.string().max(200).optional(),
  TOROB_TIMEOUT_MS: intFromEnv(1000, 60_000, 10_000),
  TOROB_CONCURRENCY: intFromEnv(1, 4, 3),
  TOROB_RATE_PER_SEC: intFromEnv(1, 20, 4),
  TOROB_CACHE_MAX_BYTES: intFromEnv(1_048_576, 536_870_912, 33_554_432),
  TOROB_MAX_RESPONSE_BYTES: intFromEnv(65_536, 33_554_432, 6_291_456),
  TOROB_TTL_SEARCH_S: intFromEnv(0, 86_400, 300),
  TOROB_TTL_PRODUCT_S: intFromEnv(0, 86_400, 900),
  TOROB_TTL_PRICE_CHART_S: intFromEnv(0, 604_800, 21_600),
  TOROB_TTL_SHOP_S: intFromEnv(0, 604_800, 21_600),
  TOROB_TTL_CITY_S: intFromEnv(0, 604_800, 86_400),
  TOROB_MAX_SUBREQUESTS: intFromEnv(1, 50, 12),
  // An empty value means unset: .env files routinely carry `TOROB_AUTH_TOKEN=` with nothing after
  // it, and that should mean "no token", not a startup failure.
  TOROB_AUTH_TOKEN: z
    .string()
    .transform((v) => (v.trim() === '' ? undefined : v.trim()))
    .pipe(z.string().min(16, 'must be at least 16 characters').optional())
    .optional(),
  TOROB_ALLOWED_ORIGINS: csv,
  TOROB_ALLOWED_HOSTS: csv,
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * The default User-Agent.
 *
 * Honest and attributable on purpose: Torob publishes no API and no rate limits, so identifying
 * ourselves with a project URL is the least we can do.
 */
export const defaultUserAgent = (): string =>
  `torob-mcp/${SERVER_VERSION} (+https://github.com/siamak/torob-mcp)`;

export function loadEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;

  const lines = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
  throw new Error(
    `Invalid configuration:\n${lines.join('\n')}\n\nSee .env.example for valid values.`,
  );
}

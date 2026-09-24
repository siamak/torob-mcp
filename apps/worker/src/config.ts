/**
 * Worker env + bindings, validated on first request.
 */

import { SERVER_VERSION } from '@torob-mcp/core';
import { z } from 'zod';

const csvHosts = z
  .string()
  .optional()
  .transform((v) =>
    v === undefined || v.trim() === ''
      ? []
      : v
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
  );

const intVar = (min: number, max: number, fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const VarsSchema = z.object({
  TOROB_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  TOROB_USER_AGENT: z.string().max(200).optional(),
  TOROB_CONCURRENCY: intVar(1, 4, 3),
  TOROB_RATE_PER_SEC: intVar(1, 20, 4),
  TOROB_MAX_SUBREQUESTS: intVar(1, 50, 12),
  TOROB_TIMEOUT_MS: intVar(1000, 60_000, 10_000),
  TOROB_ALLOWED_ORIGIN_HOSTS: csvHosts,
});

export interface WorkerBindings {
  readonly CACHE_KV: KVNamespace;
  readonly MCP_RATE_LIMIT?: RateLimit;
  /** Set via `wrangler secret put TOROB_AUTH_TOKEN` — always required. */
  readonly TOROB_AUTH_TOKEN: string;
  readonly TOROB_LOG_LEVEL?: string;
  readonly TOROB_USER_AGENT?: string;
  readonly TOROB_CONCURRENCY?: string;
  readonly TOROB_RATE_PER_SEC?: string;
  readonly TOROB_MAX_SUBREQUESTS?: string;
  readonly TOROB_TIMEOUT_MS?: string;
  readonly TOROB_ALLOWED_ORIGIN_HOSTS?: string;
}

export type WorkerConfig = z.infer<typeof VarsSchema> & {
  readonly authToken: string;
};

export const defaultUserAgent = (): string =>
  `torob-mcp/${SERVER_VERSION} (+https://github.com/siamak/torob-mcp; workers)`;

let cached: WorkerConfig | undefined;

export function loadConfig(env: WorkerBindings): WorkerConfig {
  if (cached !== undefined) return cached;

  const token = typeof env.TOROB_AUTH_TOKEN === 'string' ? env.TOROB_AUTH_TOKEN.trim() : '';
  if (token.length < 16) {
    throw new Error(
      'TOROB_AUTH_TOKEN secret is missing or too short (min 16). Run: wrangler secret put TOROB_AUTH_TOKEN',
    );
  }

  const parsed = VarsSchema.safeParse({
    TOROB_LOG_LEVEL: env.TOROB_LOG_LEVEL,
    TOROB_USER_AGENT: env.TOROB_USER_AGENT,
    TOROB_CONCURRENCY: env.TOROB_CONCURRENCY,
    TOROB_RATE_PER_SEC: env.TOROB_RATE_PER_SEC,
    TOROB_MAX_SUBREQUESTS: env.TOROB_MAX_SUBREQUESTS,
    TOROB_TIMEOUT_MS: env.TOROB_TIMEOUT_MS,
    TOROB_ALLOWED_ORIGIN_HOSTS: env.TOROB_ALLOWED_ORIGIN_HOSTS,
  });
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid Worker vars:\n${lines.join('\n')}`);
  }

  cached = { ...parsed.data, authToken: token };
  return cached;
}

/** Reset between tests. */
export function resetConfigCache(): void {
  cached = undefined;
}

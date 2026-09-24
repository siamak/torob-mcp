/**
 * Node implementation of core's Runtime.
 *
 * Everything core deliberately does not know about — pino, lru-cache, the token bucket, the
 * environment — lives here and nowhere else.
 */

import { LRUCache } from 'lru-cache';
import { pino, type Logger as PinoLogger } from 'pino';
import { DEFAULT_CONFIG, TorobError, type Cache, type Logger, type RateLimiter, type Runtime } from '@torob-mcp/core';
import { defaultUserAgent, type Env } from './config.ts';

/**
 * Size-capped in-memory cache.
 *
 * Capped in bytes rather than entries, deliberately: one Torob product-details response is ~247KB,
 * so an entry count is a poor proxy for memory. Nothing is written to disk.
 */
function createCache(maxBytes: number): Cache {
  const store = new LRUCache<string, { value: unknown; expires: number }>({
    maxSize: maxBytes,
    sizeCalculation: (entry) => {
      try {
        return Math.max(64, JSON.stringify(entry.value).length);
      } catch {
        return 64;
      }
    },
  });

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const hit = store.get(key);
      if (hit === undefined) return undefined;
      if (hit.expires <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return hit.value as T;
    },
    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      if (ttlSeconds <= 0) return;
      store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    },
  };
}

/**
 * Token bucket plus a concurrency semaphore.
 *
 * Torob returned no 429 and no rate-limit headers across 20 concurrent probes, which means it will
 * not tell us when we are being rude. These limits are ours to honour rather than theirs to
 * enforce, and are deliberately conservative.
 */
function createLimiter(ratePerSec: number, concurrency: number): RateLimiter {
  const capacity = ratePerSec * 2;
  let tokens = capacity;
  let lastRefill = Date.now();
  let inFlight = 0;
  const waiters: (() => void)[] = [];

  const refill = (): void => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - lastRefill) / 1000) * ratePerSec);
    lastRefill = now;
  };

  const release = (): void => {
    inFlight -= 1;
    waiters.shift()?.();
  };

  return {
    async acquire(): Promise<() => void> {
      const deadline = Date.now() + 30_000;

      while (inFlight >= concurrency) {
        if (Date.now() > deadline) {
          throw new TorobError('RateLimited', {
            hint: 'this server is busy talking to Torob - try again in a moment',
            detail: 'concurrency wait timed out',
          });
        }
        await new Promise<void>((resolve) => waiters.push(resolve));
      }

      for (;;) {
        refill();
        if (tokens >= 1) {
          tokens -= 1;
          break;
        }
        if (Date.now() > deadline) {
          throw new TorobError('RateLimited', {
            hint: 'this server is rate-limiting itself to stay polite to Torob - try again in a moment',
            detail: 'token wait timed out',
          });
        }
        await new Promise<void>((resolve) => setTimeout(resolve, Math.ceil(1000 / ratePerSec)));
      }

      inFlight += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release();
      };
    },
  };
}

/**
 * pino writing to stderr.
 *
 * stdout belongs to the stdio transport — a single stray byte there corrupts the protocol — so the
 * destination is fixed at fd 2 rather than configurable.
 */
export function createLogger(level: Env['TOROB_LOG_LEVEL']): PinoLogger {
  return pino({ level, base: undefined }, pino.destination(2));
}

function toCoreLogger(logger: PinoLogger): Logger {
  return {
    debug: (msg, fields) => logger.debug(fields ?? {}, msg),
    info: (msg, fields) => logger.info(fields ?? {}, msg),
    warn: (msg, fields) => logger.warn(fields ?? {}, msg),
    error: (msg, fields) => logger.error(fields ?? {}, msg),
  };
}

export function createRuntime(env: Env, logger: PinoLogger): Runtime {
  return {
    fetch: (request) => fetch(request),
    cache: createCache(env.TOROB_CACHE_MAX_BYTES),
    log: toCoreLogger(logger),
    limiter: createLimiter(env.TOROB_RATE_PER_SEC, env.TOROB_CONCURRENCY),
    now: () => Date.now(),
    random: () => Math.random(),
    config: {
      ...DEFAULT_CONFIG,
      userAgent: env.TOROB_USER_AGENT ?? defaultUserAgent(),
      timeoutMs: env.TOROB_TIMEOUT_MS,
      maxResponseBytes: env.TOROB_MAX_RESPONSE_BYTES,
      maxSubrequests: env.TOROB_MAX_SUBREQUESTS,
      ttl: {
        search: env.TOROB_TTL_SEARCH_S,
        product: env.TOROB_TTL_PRODUCT_S,
        priceChart: env.TOROB_TTL_PRICE_CHART_S,
        shop: env.TOROB_TTL_SHOP_S,
        city: env.TOROB_TTL_CITY_S,
      },
    },
  };
}

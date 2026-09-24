/**
 * The single seam between runtime-agnostic core and a host platform.
 *
 * Core imports nothing from `node:*`, touches no globals beyond web standards, and reads no
 * environment. Everything platform-specific arrives through this interface, which is what lets the
 * same code run under Node (apps/node) and workerd (apps/worker).
 */

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

export interface RateLimiter {
  /**
   * Resolves once the caller may proceed. Rejects with a RateLimited TorobError if a slot cannot
   * be had within the limiter's own wait budget.
   */
  acquire(): Promise<() => void>;
}

export interface CacheTtls {
  readonly search: number;
  readonly product: number;
  readonly priceChart: number;
  readonly shop: number;
  readonly city: number;
}

export interface CoreConfig {
  readonly userAgent: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRedirects: number;
  readonly maxSubrequests: number;
  readonly ttl: CacheTtls;
}

export interface Runtime {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly cache: Cache;
  readonly log: Logger;
  readonly limiter: RateLimiter;
  /** Injected so fake timers drive cache expiry and backoff from one place. */
  readonly now: () => number;
  /** Injected so jittered backoff is deterministic in tests without patching Math.random. */
  readonly random: () => number;
  readonly config: CoreConfig;
}

export const DEFAULT_TTLS: CacheTtls = {
  search: 300,
  product: 900,
  priceChart: 21_600,
  shop: 21_600,
  city: 86_400,
};

export const DEFAULT_CONFIG: Omit<CoreConfig, 'userAgent'> = {
  timeoutMs: 10_000,
  // One base-product/details response is ~247KB; the cap exists to stop a pathological body,
  // not to trim normal ones.
  maxResponseBytes: 6 * 1024 * 1024,
  maxRedirects: 2,
  maxSubrequests: 12,
  ttl: DEFAULT_TTLS,
};

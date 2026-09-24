/**
 * Test doubles for the Runtime seam.
 *
 * Because core takes `fetch` through Runtime, the network is mocked by injection rather than by
 * patching the global stack. That is both simpler than MSW and a requirement for Phase 5: these
 * same tests have to run inside workerd, where an interceptor library would not.
 */

import { DEFAULT_CONFIG, type Cache, type Logger, type RateLimiter, type Runtime } from '../src/index.ts';

export interface FetchCall {
  url: string;
  headers: Record<string, string>;
}

export interface StubOptions {
  /** Responses served in order; the last one repeats once exhausted. */
  responses: (Response | (() => Response | Promise<Response>))[];
}

export function recordingFetch(options: StubOptions): {
  fetch: Runtime['fetch'];
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  let index = 0;

  const fetch: Runtime['fetch'] = async (request) => {
    calls.push({
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
    });
    const entry = options.responses[Math.min(index, options.responses.length - 1)];
    index += 1;
    if (entry === undefined) throw new Error('no stub response configured');
    return typeof entry === 'function' ? await entry() : entry.clone();
  };

  return { fetch, calls };
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const text = (body: string, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(body, { status, headers });

export function memoryCache(): Cache & { size: () => number } {
  const store = new Map<string, { value: unknown; expires: number }>();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const hit = store.get(key);
      if (hit === undefined || hit.expires <= Date.now()) return undefined;
      return hit.value as T;
    },
    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      if (ttlSeconds > 0) store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    },
    size: () => store.size,
  };
}

export const silentLogger = (): Logger => ({
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

export const passthroughLimiter = (): RateLimiter => ({
  acquire: async () => () => undefined,
});

export function testRuntime(overrides: Partial<Runtime> = {}): Runtime {
  return {
    fetch: async () => json({}),
    cache: memoryCache(),
    log: silentLogger(),
    limiter: passthroughLimiter(),
    now: () => 0,
    // Fixed so jittered backoff is reproducible.
    random: () => 0,
    config: { ...DEFAULT_CONFIG, userAgent: 'torob-mcp-test/0 (+https://example.test)' },
    ...overrides,
  };
}

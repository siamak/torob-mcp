/**
 * Tiered cache: Cache API for short TTLs (per-colo hot), KV for long TTLs.
 */

import type { Cache } from '@torob-mcp/core';

/** TTLs at or above this go to KV so they survive colo cold starts. */
const KV_TTL_FLOOR_S = 3_600;

async function openHotCache(): Promise<globalThis.Cache> {
  // workers-types DOM lib omits caches.default; open() is the portable path.
  return caches.open('torob-mcp-hot');
}

export function createWorkerCache(kv: KVNamespace): Cache {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const cacheKey = cacheRequest(key);

      try {
        const hot = await (await openHotCache()).match(cacheKey);
        if (hot !== undefined) {
          return (await hot.json()) as T;
        }
      } catch {
        // Cache API can throw in some test/dev contexts — fall through to KV.
      }

      const cold = await kv.get(key, 'json');
      return cold === null ? undefined : (cold as T);
    },

    async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
      if (ttlSeconds <= 0) return;
      const body = JSON.stringify(value);
      const cacheKey = cacheRequest(key);

      if (ttlSeconds < KV_TTL_FLOOR_S) {
        try {
          await (
            await openHotCache()
          ).put(
            cacheKey,
            new Response(body, {
              headers: {
                'content-type': 'application/json',
                'cache-control': `public, max-age=${ttlSeconds}`,
              },
            }),
          );
        } catch {
          // ignore Cache API failures
        }
        return;
      }

      // KV minimum TTL is 60s; expirationTtl is seconds from now.
      await kv.put(key, body, { expirationTtl: Math.max(60, ttlSeconds) });
    },
  };
}

function cacheRequest(key: string): Request {
  // Cache API keys must be absolute HTTP(S) URLs. The host is never fetched.
  return new Request(`https://torob-mcp.cache.internal/${encodeURIComponent(key)}`);
}

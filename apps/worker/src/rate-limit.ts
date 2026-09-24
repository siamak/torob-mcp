/**
 * Upstream token bucket (per isolate) + optional Workers Rate Limiting binding (per token/IP).
 */

import { type RateLimiter, TorobError } from '@torob-mcp/core';

export function createUpstreamLimiter(ratePerSec: number, concurrency: number): RateLimiter {
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

/** Edge rate limit keyed by bearer token fingerprint or client IP. */
export async function edgeRateLimit(
  binding: RateLimit | undefined,
  key: string,
): Promise<boolean> {
  if (binding === undefined) return false;
  try {
    const { success } = await binding.limit({ key });
    return !success;
  } catch {
    // Binding misconfigured or plan limitation — do not fail open into a hard 500.
    return false;
  }
}

export function clientRateKey(request: Request, token: string): string {
  // Prefer the auth token so one user cannot burn another's budget via IP sharing.
  if (token.length >= 16) return `tok:${token.slice(0, 8)}…${token.slice(-4)}`;
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

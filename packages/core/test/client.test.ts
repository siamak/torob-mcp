/**
 * Client tests.
 *
 * The network is mocked by injecting `fetch` through Runtime rather than with MSW or undici's
 * MockAgent. That is deliberate: it exercises exactly the same code path, needs no interception of
 * the global stack, and is a prerequisite for Phase 5, where this same suite has to run inside
 * workerd - where an interceptor library would not load.
 */

import { z } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/torob/client.ts';
import * as endpoints from '../src/torob/endpoints.ts';
import { TorobError } from '../src/torob/errors.ts';
import { json, memoryCache, recordingFetch, testRuntime, text } from './helpers.ts';

const Schema = z.object({ ok: z.boolean() });
const spec = {
  url: new URL('https://api.torob.com/v4/base-product/search/?q=x'),
  label: '/search/',
};
const opts = { ttlSeconds: 0, cacheKey: 'k' };

describe('happy path', () => {
  it('parses a valid response', async () => {
    const { fetch } = recordingFetch({ responses: [json({ ok: true })] });
    const result = await request(testRuntime({ fetch }), spec, Schema, opts);
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it('sends the configured User-Agent and no cookies', async () => {
    const { fetch, calls } = recordingFetch({ responses: [json({ ok: true })] });
    await request(testRuntime({ fetch }), spec, Schema, opts);
    expect(calls[0]?.headers['user-agent']).toContain('torob-mcp-test');
    expect(calls[0]?.headers).not.toHaveProperty('cookie');
  });

  it('sends the derived deliver_city header only when a city was asked for', async () => {
    const id = endpoints.productId('57ea65ae-0798-4cd0-96a7-38d8af180345');
    const { fetch, calls } = recordingFetch({
      responses: [json({ ok: true }), json({ ok: true })],
    });
    const runtime = testRuntime({ fetch });

    await request(runtime, endpoints.sellers(id, 'in_store'), Schema, opts);
    await request(runtime, endpoints.sellers(id, 'in_store', endpoints.cityId(712)), Schema, opts);

    expect(calls[0]?.headers).not.toHaveProperty('cookie');
    expect(calls[1]?.headers['cookie']).toBe('deliver_city=712');
  });
});

describe('SSRF defences', () => {
  it('refuses a host outside the allowlist', async () => {
    const { fetch, calls } = recordingFetch({ responses: [json({ ok: true })] });
    const result = await request(
      testRuntime({ fetch }),
      { url: new URL('https://evil.example/v4/'), label: '/evil/' },
      Schema,
      opts,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('Blocked');
    // The request must never have been issued.
    expect(calls).toHaveLength(0);
  });

  it('refuses plain http even on an allowed host', async () => {
    const { fetch, calls } = recordingFetch({ responses: [json({ ok: true })] });
    const result = await request(
      testRuntime({ fetch }),
      { url: new URL('http://api.torob.com/v4/'), label: '/x/' },
      Schema,
      opts,
    );
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('refuses to follow a redirect off the allowlist', async () => {
    const { fetch, calls } = recordingFetch({
      responses: [text('', 302, { location: 'https://evil.example/steal' }), json({ ok: true })],
    });
    const result = await request(testRuntime({ fetch }), spec, Schema, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('Blocked');
    // The first hop happened; the second must not have.
    expect(calls).toHaveLength(1);
  });

  it('follows a redirect that stays on the allowlist', async () => {
    const { fetch, calls } = recordingFetch({
      responses: [
        text('', 301, { location: 'https://api.torob.com/v4/base-product/search/?q=y' }),
        json({ ok: true }),
      ],
    });
    const result = await request(testRuntime({ fetch }), spec, Schema, opts);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('gives up rather than looping on redirects', async () => {
    const { fetch } = recordingFetch({
      responses: [text('', 302, { location: 'https://api.torob.com/v4/loop/' })],
    });
    const result = await request(testRuntime({ fetch }), spec, Schema, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('Upstream');
  });

  it('rejects ids that are not UUIDs before a URL is ever built', () => {
    for (const bad of ['not-a-uuid', '../../admin', '', 'http://evil.example']) {
      expect(() => endpoints.productId(bad)).toThrow(TorobError);
    }
  });
});

describe('error classification', () => {
  const classify = async (response: Response) => {
    const { fetch } = recordingFetch({ responses: [response] });
    const result = await request(testRuntime({ fetch }), spec, Schema, opts);
    if (result.ok) throw new Error('expected a failure');
    return result.error;
  };

  it('maps a missing record to NotFound with an actionable hint', async () => {
    const error = await classify(json({ message: 'Base product not found: abc' }, 404));
    expect(error.kind).toBe('NotFound');
    expect(error.hint).toContain('search_torob');
  });

  it('maps a missing route to Upstream, not NotFound', async () => {
    // "صفحه‌ی مورد نظر پیدا نشد" means the endpoint is gone - that is drift, not a missing record.
    const error = await classify(json({ error: { message: 'صفحه‌ی مورد نظر پیدا نشد.' } }, 404));
    expect(error.kind).toBe('Upstream');
  });

  it('maps an HTML body to Blocked, which is how a geo-block looks', async () => {
    const error = await classify(text('<!DOCTYPE html><html>Access denied</html>', 403));
    expect(error.kind).toBe('Blocked');
    expect(error.hint).toContain('blocking');
  });

  it('maps 429 to RateLimited', async () => {
    const error = await classify(json({}, 429));
    expect(error.kind).toBe('RateLimited');
  });

  it('maps unparseable JSON to SchemaDrift', async () => {
    const error = await classify(text('{not json', 200, { 'content-type': 'application/json' }));
    expect(error.kind).toBe('SchemaDrift');
  });

  it('maps a shape change to SchemaDrift without leaking the body', async () => {
    const error = await classify(json({ ok: 'yes' }));
    expect(error.kind).toBe('SchemaDrift');
    expect(error.hint).not.toContain('yes');
  });

  it('never puts the query or a stack trace into the model-visible hint', async () => {
    const error = await classify(json({ message: 'Base product not found: abc' }, 404));
    expect(error.hint).not.toContain('q=x');
    expect(error.hint).not.toContain('api.torob.com');
    // A stack trace would arrive as multiple lines naming files.
    expect(error.hint).not.toContain('\n');
    expect(error.hint).not.toMatch(/\.ts:\d+/);
  });
});

describe('retries and backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  const run = async (responses: (() => Response)[]) => {
    const { fetch, calls } = recordingFetch({ responses });
    const promise = request(testRuntime({ fetch }), spec, Schema, opts);
    await vi.runAllTimersAsync();
    return { result: await promise, calls };
  };

  it('retries a 500 and succeeds', async () => {
    const { result, calls } = await run([json({}, 500), json({ ok: true })]);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('retries a 429 up to the attempt ceiling, then gives up', async () => {
    const { result, calls } = await run([json({}, 429), json({}, 429), json({}, 429)]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('RateLimited');
    expect(calls).toHaveLength(3);
  });

  it('does not retry a 404, which is a fact about the request', async () => {
    const { result, calls } = await run([json({ message: 'nope' }, 404)]);
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('does not retry a schema mismatch', async () => {
    const { result, calls } = await run([json({ ok: 'wrong type' })]);
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('does not retry an off-allowlist redirect', async () => {
    const { result, calls } = await run([text('', 302, { location: 'https://evil.example/' })]);
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe('resource limits', () => {
  it('aborts a body past the size cap instead of buffering it', async () => {
    const oversized = (): Response =>
      new Response('x'.repeat(5000), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const { fetch } = recordingFetch({ responses: [oversized] });
    const runtime = testRuntime({
      fetch,
      config: { ...testRuntime().config, maxResponseBytes: 1000 },
    });

    const result = await request(runtime, spec, Schema, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('Upstream');
  });

  it('does not trust a lying content-length', async () => {
    // The cap counts bytes as they arrive rather than reading the header.
    const lying = (): Response =>
      new Response('y'.repeat(5000), {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': '10' },
      });
    const { fetch } = recordingFetch({ responses: [lying] });
    const runtime = testRuntime({
      fetch,
      config: { ...testRuntime().config, maxResponseBytes: 1000 },
    });
    const result = await request(runtime, spec, Schema, opts);
    expect(result.ok).toBe(false);
  });

  it('reports a timeout as Timeout', async () => {
    const fetch = async (): Promise<Response> => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    };
    vi.useFakeTimers();
    const promise = request(testRuntime({ fetch }), spec, Schema, opts);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('Timeout');
      expect(result.error.hint).toContain('try again');
    }
  });
});

describe('caching', () => {
  it('serves a second identical call from cache', async () => {
    const { fetch, calls } = recordingFetch({ responses: [json({ ok: true })] });
    const runtime = testRuntime({ fetch, cache: memoryCache() });
    const cached = { ttlSeconds: 300, cacheKey: 'same' };

    await request(runtime, spec, Schema, cached);
    await request(runtime, spec, Schema, cached);
    expect(calls).toHaveLength(1);
  });

  it('treats a different cache key as a different query', async () => {
    const { fetch, calls } = recordingFetch({ responses: [json({ ok: true })] });
    const runtime = testRuntime({ fetch, cache: memoryCache() });

    await request(runtime, spec, Schema, { ttlSeconds: 300, cacheKey: 'a' });
    await request(runtime, spec, Schema, { ttlSeconds: 300, cacheKey: 'b' });
    expect(calls).toHaveLength(2);
  });

  it('does not cache when the TTL is zero', async () => {
    const { fetch, calls } = recordingFetch({ responses: [json({ ok: true })] });
    const runtime = testRuntime({ fetch, cache: memoryCache() });

    await request(runtime, spec, Schema, opts);
    await request(runtime, spec, Schema, opts);
    expect(calls).toHaveLength(2);
  });

  it('does not cache a failure', async () => {
    const { fetch, calls } = recordingFetch({
      responses: [json({ message: 'nope' }, 404), json({ ok: true })],
    });
    const runtime = testRuntime({ fetch, cache: memoryCache() });
    const cached = { ttlSeconds: 300, cacheKey: 'same' };

    expect((await request(runtime, spec, Schema, cached)).ok).toBe(false);
    expect((await request(runtime, spec, Schema, cached)).ok).toBe(true);
    expect(calls).toHaveLength(2);
  });
});

describe('rate limiting', () => {
  it('releases its slot even when the request fails', async () => {
    let held = 0;
    let peak = 0;
    const limiter = {
      acquire: async () => {
        held += 1;
        peak = Math.max(peak, held);
        return () => {
          held -= 1;
        };
      },
    };
    const { fetch } = recordingFetch({ responses: [json({ message: 'nope' }, 404)] });
    await request(testRuntime({ fetch, limiter }), spec, Schema, opts);
    expect(held).toBe(0);
    expect(peak).toBe(1);
  });

  it('surfaces a limiter refusal as RateLimited', async () => {
    const limiter = {
      acquire: async () => {
        throw new TorobError('RateLimited', { hint: 'busy' });
      },
    };
    const { fetch } = recordingFetch({ responses: [json({ ok: true })] });
    vi.useFakeTimers();
    const promise = request(testRuntime({ fetch, limiter }), spec, Schema, opts);
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('RateLimited');
  });
});

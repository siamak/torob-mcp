/**
 * The only file in the project that calls `runtime.fetch`.
 *
 * Pipeline, in order: build URL -> assert host -> cache read -> rate limit -> fetch with timeout ->
 * manual redirects (re-asserting the host on every hop) -> size-capped body read -> status branch
 * -> JSON parse -> zod parse -> cache write.
 */

import type { ZodType } from 'zod';
import type { Runtime } from '../runtime.ts';
import { ALLOWED_HOSTS, type EndpointSpec } from './endpoints.ts';
import { err, ok, type Result, TorobError } from './errors.ts';
import { ErrorBodySchema } from './schemas.ts';

export interface RequestOptions {
  /** Cache TTL in seconds. Zero disables caching for this call. */
  readonly ttlSeconds: number;
  /** Normalized arguments the cache key is built from — never the raw URL. */
  readonly cacheKey: string;
}

const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 250;
const MAX_TOTAL_BACKOFF_MS = 4000;

/**
 * Asserts a URL is one we are allowed to contact.
 *
 * Exact hostname match against the frozen allowlist, https only, default port only. Runs on the
 * initial URL and again on every redirect target.
 */
function assertAllowed(url: URL, endpoint: string): void {
  const allowed =
    url.protocol === 'https:' &&
    ALLOWED_HOSTS.has(url.hostname) &&
    (url.port === '' || url.port === '443');
  if (!allowed) {
    throw new TorobError('Blocked', {
      hint: 'refused to contact a host outside torob.com - this is a bug in torob-mcp, please report it',
      endpoint,
      detail: `blocked host ${url.protocol}//${url.hostname}`,
    });
  }
}

/**
 * Reads a body with a hard byte ceiling.
 *
 * Streamed through a counting reader rather than trusting `content-length`, which a hostile or
 * broken upstream can understate.
 */
async function readCapped(response: Response, maxBytes: number, endpoint: string): Promise<string> {
  const body = response.body;
  if (body === null) return '';

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new TorobError('Upstream', {
          hint: 'Torob returned an unexpectedly large response - try a narrower query',
          endpoint,
          detail: `body exceeded ${maxBytes} bytes`,
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
    await body.cancel().catch(() => undefined);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Extracts the Persian or English message from whichever of the three error shapes came back. */
function upstreamMessage(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const result = ErrorBodySchema.safeParse(parsed);
  if (!result.success) return undefined;
  const body: Record<string, unknown> = result.data;
  if (typeof body.message === 'string') return body.message;
  const nested = body.error;
  if (typeof nested === 'object' && nested !== null) {
    const message = (nested as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  return undefined;
}

/**
 * Classifies a non-2xx response.
 *
 * Status is branched on *before* the body is parsed, because a malformed product id returns a
 * 200-shaped body under a 404 (docs/ENDPOINTS.md).
 */
function classify(status: number, text: string, endpoint: string): TorobError {
  const message = upstreamMessage(text);
  const looksLikeHtml = /^\s*<(?:!doctype|html)/i.test(text);

  if (looksLikeHtml) {
    return new TorobError('Blocked', {
      hint: 'Torob is blocking this server (common on cloud and datacenter IPs) - see the deployment notes in the README',
      status,
      endpoint,
      detail: 'html body where json was expected',
    });
  }

  if (status === 429) {
    return new TorobError('RateLimited', {
      hint: 'Torob is rate-limiting this server - wait a few seconds and try again',
      status,
      endpoint,
    });
  }

  if (status === 503) {
    return new TorobError('RateLimited', {
      hint: 'Torob is temporarily unavailable - try again shortly',
      status,
      endpoint,
    });
  }

  if (status === 404 || status === 400) {
    // "صفحه‌ی مورد نظر پیدا نشد" means the *route* is gone, which is drift, not a missing record.
    if (message?.includes('صفحه')) {
      return new TorobError('Upstream', {
        hint: 'a Torob endpoint changed - this is a bug in torob-mcp, please report it',
        status,
        endpoint,
        detail: message,
      });
    }
    return new TorobError('NotFound', {
      hint: 'Torob has no record with that id - call search_torob first to get a valid product_id',
      status,
      endpoint,
      detail: message ?? 'no message',
    });
  }

  return new TorobError('Upstream', {
    hint: `Torob returned an unexpected status (${status}) - try again shortly`,
    status,
    endpoint,
    detail: message ?? 'no message',
  });
}

/** Full-jitter exponential backoff, drawn from the injected RNG so tests are deterministic. */
function backoffMs(attempt: number, random: () => number): number {
  const ceiling = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_TOTAL_BACKOFF_MS);
  return Math.floor(random() * ceiling);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(
  runtime: Runtime,
  spec: EndpointSpec,
): Promise<{ status: number; text: string }> {
  const { config } = runtime;
  let url = new URL(spec.url.toString());
  assertAllowed(url, spec.label);

  for (let hop = 0; hop <= config.maxRedirects; hop += 1) {
    const request = new Request(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(config.timeoutMs),
      headers: {
        'user-agent': config.userAgent,
        accept: 'application/json',
        'accept-language': 'fa-IR,fa;q=0.9',
        ...spec.headers,
      },
    });

    const response = await runtime.fetch(request);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (location === null) {
        throw new TorobError('Upstream', {
          hint: 'Torob sent a redirect with no destination - try again shortly',
          status: response.status,
          endpoint: spec.label,
        });
      }
      // Re-assert on every hop: an off-allowlist Location is a hard stop, never a follow.
      url = new URL(location, url);
      assertAllowed(url, spec.label);
      continue;
    }

    const text = await readCapped(response, config.maxResponseBytes, spec.label);
    return { status: response.status, text };
  }

  throw new TorobError('Upstream', {
    hint: 'Torob redirected too many times - try again shortly',
    endpoint: spec.label,
  });
}

/**
 * Issues a request, or serves it from cache.
 *
 * Returns Result rather than throwing: core never throws across the tool boundary.
 */
export async function request<T>(
  runtime: Runtime,
  spec: EndpointSpec,
  schema: ZodType<T>,
  options: RequestOptions,
): Promise<Result<T>> {
  const key = `v1:${spec.label}:${options.cacheKey}`;

  if (options.ttlSeconds > 0) {
    const cached = await runtime.cache.get<T>(key);
    if (cached !== undefined) {
      runtime.log.debug('cache hit', { endpoint: spec.label });
      return ok(cached);
    }
  }

  let lastError: TorobError | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let release: (() => void) | undefined;
    try {
      release = await runtime.limiter.acquire();
      const { status, text } = await fetchOnce(runtime, spec);

      if (status < 200 || status >= 300) {
        const error = classify(status, text, spec.label);
        // 4xx is a fact about the request, not a transient failure.
        if (!RETRYABLE_STATUS.has(status)) return err(error);
        lastError = error;
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          return err(
            new TorobError('SchemaDrift', {
              hint: "Torob's response was not valid JSON - this is a bug in torob-mcp, please report it",
              endpoint: spec.label,
              detail: 'json parse failed',
            }),
          );
        }

        const result = schema.safeParse(parsed);
        if (!result.success) {
          // The zod issue path goes to debug logs only — never into the model's context.
          runtime.log.debug('schema drift', {
            endpoint: spec.label,
            issues: result.error.issues.slice(0, 5).map((i) => i.path.join('.')),
          });
          return err(
            new TorobError('SchemaDrift', {
              hint: "Torob's response format changed - this is a bug in torob-mcp, please report it",
              endpoint: spec.label,
              detail: result.error.issues[0]?.message ?? 'schema mismatch',
            }),
          );
        }

        if (options.ttlSeconds > 0) {
          await runtime.cache.set(key, result.data, options.ttlSeconds);
        }
        return ok(result.data);
      }
    } catch (error) {
      if (error instanceof TorobError) {
        // Host-allowlist and size-cap failures are decisions, not transient faults.
        if (error.kind === 'Blocked' || error.kind === 'Upstream') return err(error);
        lastError = error;
      } else if (error instanceof DOMException && error.name === 'TimeoutError') {
        lastError = new TorobError('Timeout', {
          hint: `Torob did not respond within ${runtime.config.timeoutMs / 1000}s - try again`,
          endpoint: spec.label,
        });
      } else {
        lastError = new TorobError('Upstream', {
          hint: 'could not reach Torob - check this machine’s network connection',
          endpoint: spec.label,
          detail: error instanceof Error ? error.name : 'unknown',
        });
      }
    } finally {
      release?.();
    }

    if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffMs(attempt, runtime.random));
  }

  return err(
    lastError ??
      new TorobError('Upstream', {
        hint: 'could not reach Torob - try again shortly',
        endpoint: spec.label,
      }),
  );
}

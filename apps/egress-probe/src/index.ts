/**
 * Phase 5.0 egress gate — throwaway Worker.
 *
 * Hits every Torob JSON endpoint documented in docs/ENDPOINTS.md from Cloudflare's
 * egress and classifies each response as JSON or a challenge/block page. Results are
 * returned immediately and also appended to a KV list keyed by colo + UTC day so we
 * can accumulate samples over several days and regions.
 *
 * This is not the production MCP Worker. Delete after the gate decision is recorded.
 */

export interface Env {
  readonly RESULTS: KVNamespace;
}

interface ProbeTarget {
  readonly name: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Stable fixture ids from fixtures/ — public product/shop pages, not private queries. */
const SAMPLE_PRK = '57ea65ae-0798-4cd0-96a7-38d8af180345';
const SAMPLE_SHOP_ID = 299463;
const SAMPLE_CATEGORY = 94;

const TARGETS: readonly ProbeTarget[] = [
  {
    name: 'search',
    url: 'https://api.torob.com/v4/base-product/search/?q=iphone&page=0&size=1',
  },
  {
    name: 'suggestion2',
    url: 'https://api.torob.com/suggestion2/?q=ayfon&source=next',
  },
  {
    name: 'details',
    url: `https://api.torob.com/v4/base-product/details/?prk=${SAMPLE_PRK}`,
  },
  {
    name: 'sellers',
    url: `https://api.torob.com/v4/base-product/sellers/?prk=${SAMPLE_PRK}&list_type=products_info`,
  },
  {
    name: 'stores',
    url: `https://api.torob.com/v4/base-product/sellers/?prk=${SAMPLE_PRK}&list_type=products_in_store_info`,
  },
  {
    name: 'map_sellers',
    url: `https://api.torob.com/v4/base-product/map/sellers/?prk=${SAMPLE_PRK}`,
  },
  {
    name: 'price_chart',
    url: `https://api.torob.com/v4/base-product/price-chart/?prk=${SAMPLE_PRK}`,
  },
  {
    name: 'similar',
    url: `https://api.torob.com/v4/base-product/similar-base-product/?prk=${SAMPLE_PRK}`,
  },
  {
    name: 'shop',
    url: `https://api.torob.com/v4/internet-shop/details/?id=${SAMPLE_SHOP_ID}`,
  },
  {
    name: 'city_list',
    url: 'https://api.torob.com/v4/city/list/?search=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&size=5',
  },
  {
    name: 'brand_list',
    url: `https://api.torob.com/v4/brand/list/?cat_list=${SAMPLE_CATEGORY}`,
  },
];

type BodyKind = 'json' | 'challenge' | 'html' | 'empty' | 'other' | 'error';

interface EndpointResult {
  readonly name: string;
  readonly url: string;
  readonly status: number | null;
  readonly latency_ms: number;
  readonly content_type: string | null;
  readonly body_kind: BodyKind;
  readonly body_bytes: number;
  readonly preview: string;
  readonly challenge_markers: readonly string[];
  readonly error: string | null;
}

interface ProbeReport {
  readonly probed_at: string;
  readonly worker_colo: string | null;
  readonly worker_country: string | null;
  readonly cf_ray: string | null;
  readonly verdict: 'clean' | 'blocked' | 'mixed' | 'error';
  readonly clean_count: number;
  readonly blocked_count: number;
  readonly endpoints: readonly EndpointResult[];
}

const CHALLENGE_MARKERS = [
  'cf-browser-verification',
  'cf-challenge',
  'challenge-platform',
  'just a moment',
  'attention required',
  'enable javascript and cookies',
  'checking your browser',
  'access denied',
  '_cf_chl',
  'cloudflare',
] as const;

function classifyBody(
  status: number | null,
  contentType: string | null,
  text: string,
): {
  kind: BodyKind;
  markers: string[];
} {
  if (status === null) return { kind: 'error', markers: [] };
  const lower = text.slice(0, 8_000).toLowerCase();
  const markers = CHALLENGE_MARKERS.filter((m) => lower.includes(m));
  const ct = (contentType ?? '').toLowerCase();

  if (markers.length > 0) return { kind: 'challenge', markers };
  if (ct.includes('application/json') || looksLikeJson(text)) return { kind: 'json', markers: [] };
  if (text.trim() === '') return { kind: 'empty', markers: [] };
  if (ct.includes('text/html') || lower.startsWith('<!doctype') || lower.startsWith('<html')) {
    return { kind: 'html', markers: [] };
  }
  return { kind: 'other', markers: [] };
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

function previewOf(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 160);
}

async function probeOne(target: ProbeTarget): Promise<EndpointResult> {
  const started = Date.now();
  try {
    const res = await fetch(target.url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        accept: 'application/json',
        'user-agent': 'torob-mcp-egress-probe/0.0.0 (+https://github.com/siamak/torob-mcp)',
        ...target.headers,
      },
    });
    // Cap read — details can be ~247 KB; we only need a classification sample.
    const buf = await res.arrayBuffer();
    const limited = buf.byteLength > 64_000 ? buf.slice(0, 64_000) : buf;
    const text = new TextDecoder('utf-8', { fatal: false }).decode(limited);
    const contentType = res.headers.get('content-type');
    const { kind, markers } = classifyBody(res.status, contentType, text);
    return {
      name: target.name,
      url: target.url,
      status: res.status,
      latency_ms: Date.now() - started,
      content_type: contentType,
      body_kind: kind,
      body_bytes: buf.byteLength,
      preview: previewOf(text),
      challenge_markers: markers,
      error: null,
    };
  } catch (err) {
    return {
      name: target.name,
      url: target.url,
      status: null,
      latency_ms: Date.now() - started,
      content_type: null,
      body_kind: 'error',
      body_bytes: 0,
      preview: '',
      challenge_markers: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function verdictOf(endpoints: readonly EndpointResult[]): ProbeReport['verdict'] {
  if (endpoints.some((e) => e.body_kind === 'error' && e.status === null)) {
    // Network-level failures still count toward blocked for gate purposes if any JSON is missing.
  }
  const clean = endpoints.filter(
    (e) => e.body_kind === 'json' && e.status !== null && e.status < 500,
  );
  const blocked = endpoints.filter(
    (e) => e.body_kind === 'challenge' || e.body_kind === 'html' || e.body_kind === 'error',
  );
  if (clean.length === endpoints.length) return 'clean';
  if (blocked.length === endpoints.length) return 'blocked';
  if (clean.length === 0) return 'error';
  return 'mixed';
}

async function runProbe(request: Request | null): Promise<ProbeReport> {
  const endpoints: EndpointResult[] = [];
  // Sequential: politeness + clearer per-endpoint latency under Workers CPU limits.
  for (const target of TARGETS) {
    endpoints.push(await probeOne(target));
  }

  const cf = request?.cf as CfProperties | undefined;
  return {
    probed_at: new Date().toISOString(),
    worker_colo: typeof cf?.colo === 'string' ? cf.colo : null,
    worker_country: typeof cf?.country === 'string' ? cf.country : null,
    cf_ray: request?.headers.get('cf-ray'),
    verdict: verdictOf(endpoints),
    clean_count: endpoints.filter((e) => e.body_kind === 'json').length,
    blocked_count: endpoints.filter(
      (e) => e.body_kind === 'challenge' || e.body_kind === 'html' || e.body_kind === 'error',
    ).length,
    endpoints,
  };
}

async function appendResult(env: Env, report: ProbeReport): Promise<void> {
  const day = report.probed_at.slice(0, 10);
  const colo = report.worker_colo ?? 'unknown';
  // Key alone is the index — list by prefix. Avoids lost updates from concurrent RMW on a day list.
  const key = `sample:${day}:${colo}:${report.probed_at}`;
  await env.RESULTS.put(key, JSON.stringify(report), { expirationTtl: 60 * 60 * 24 * 14 });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return json({ ok: true, service: 'torob-egress-probe' });
    }

    if (request.method === 'GET' && url.pathname === '/results') {
      const day = url.searchParams.get('day') ?? new Date().toISOString().slice(0, 10);
      const listed = await env.RESULTS.list({ prefix: `sample:${day}:`, limit: 100 });
      const samples = [];
      for (const key of listed.keys.map((k) => k.name).slice(-50)) {
        const sample = await env.RESULTS.get(key, 'json');
        if (sample !== null) samples.push(sample);
      }
      return json({ day, count: samples.length, samples });
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/probe')) {
      const report = await runProbe(request);
      // Persist even on blocked — that is the signal we need.
      await appendResult(env, report);
      return json(report);
    }

    return json({ error: 'not found', paths: ['/probe', '/results', '/healthz'] }, 404);
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    // Cron has no inbound Request.cf; colo will be null — still useful for time-series.
    ctx.waitUntil(
      (async () => {
        const report = await runProbe(null);
        await appendResult(env, report);
      })(),
    );
  },
};

/**
 * Streamable HTTP transport.
 *
 * Binds to loopback by default. A non-local bind requires a bearer token unless the operator
 * explicitly passes --insecure, and either way logs a warning at startup.
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Runtime } from '@torob-mcp/core';
import type { Logger } from 'pino';
import { createServer } from './stdio.ts';

export interface HttpOptions {
  readonly host: string;
  readonly port: number;
  readonly token: string | undefined;
  readonly insecure: boolean;
  readonly allowedOrigins: readonly string[];
  readonly allowedHosts: readonly string[];
}

const MAX_BODY_BYTES = 1_048_576;
const SESSION_IDLE_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 64;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 120;

const isLoopback = (host: string): boolean =>
  host === '127.0.0.1' || host === '::1' || host === 'localhost';

/** Constant-time bearer comparison, length-padded so the compare itself leaks nothing. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still compare, to keep the timing profile flat.
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * The SDK declares Transport's optional members as `?: T | undefined`, which exactOptionalPropertyTypes
 * rejects at the call site. This alias plus the one cast below is a shim for third-party
 * declarations only - it is never applied to network data, which always goes through zod.
 */
type SdkTransport = Parameters<McpServer['connect']>[0];

interface Session {
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

export function startHttp(runtime: Runtime, log: Logger, options: HttpOptions): Server {
  if (!isLoopback(options.host)) {
    if (options.token === undefined && !options.insecure) {
      throw new Error(
        `Refusing to bind ${options.host} without authentication.\n` +
          'Set TOROB_AUTH_TOKEN, or pass --insecure if you genuinely intend an open server.',
      );
    }
    log.warn(
      { host: options.host, authenticated: options.token !== undefined },
      'binding a non-loopback address - this server is reachable from outside this machine',
    );
  }

  const sessions = new Map<string, Session>();
  const hits = new Map<string, { count: number; resetAt: number }>();

  const sweep = (): void => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastSeen > SESSION_IDLE_MS) {
        void session.transport.close();
        sessions.delete(id);
      }
    }
    for (const [key, hit] of hits) if (hit.resetAt <= now) hits.delete(key);
  };
  const sweeper = setInterval(sweep, 60_000);
  sweeper.unref();

  const rateLimited = (key: string): boolean => {
    const now = Date.now();
    const hit = hits.get(key);
    if (hit === undefined || hit.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return false;
    }
    hit.count += 1;
    return hit.count > RATE_MAX_REQUESTS;
  };

  const send = (res: ServerResponse, status: number, body: unknown): void => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
    });
    res.end(payload);
  };

  /**
   * DNS-rebinding protection: a browser can be made to resolve an attacker domain to 127.0.0.1,
   * so Origin and Host are both checked rather than trusting the bind address.
   */
  const originAllowed = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    if (origin === undefined) return true; // non-browser client
    if (options.allowedOrigins.length === 0) return false;
    return options.allowedOrigins.includes(origin);
  };

  const hostAllowed = (req: IncomingMessage): boolean => {
    const host = req.headers.host?.split(':')[0];
    if (host === undefined) return false;
    if (options.allowedHosts.length > 0) return options.allowedHosts.includes(host);
    return isLoopback(host) || host === options.host;
  };

  const server = createHttpServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      log.error({ err: error instanceof Error ? error.name : 'unknown' }, 'request failed');
      if (!res.headersSent) send(res, 500, { error: 'internal error' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // Deliberately makes no upstream call, so a health probe cannot be used to hammer Torob.
    if (req.method === 'GET' && url.pathname === '/healthz') {
      send(res, 200, { status: 'ok', sessions: sessions.size });
      return;
    }

    if (url.pathname !== '/mcp') {
      send(res, 404, { error: 'not found' });
      return;
    }

    if (!hostAllowed(req) || !originAllowed(req)) {
      log.warn({ origin: req.headers.origin }, 'rejected request on Origin/Host check');
      send(res, 403, { error: 'origin or host not allowed' });
      return;
    }

    if (options.token !== undefined) {
      const header = req.headers.authorization ?? '';
      const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (provided === '' || !tokenMatches(provided, options.token)) {
        send(res, 401, { error: 'unauthorized' });
        return;
      }
    }

    const clientKey = req.socket.remoteAddress ?? 'unknown';
    if (rateLimited(clientKey)) {
      send(res, 429, { error: 'too many requests' });
      return;
    }

    if (req.method !== 'POST') {
      send(res, 405, { error: 'method not allowed' });
      return;
    }

    const body = await readBody(req);
    if (body === undefined) {
      send(res, 413, { error: 'request body too large' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      send(res, 400, { error: 'invalid json' });
      return;
    }

    const sessionId = req.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;

    if (existing !== undefined) {
      existing.lastSeen = Date.now();
      await existing.transport.handleRequest(req, res, parsed);
      return;
    }

    if (sessions.size >= MAX_SESSIONS) {
      sweep();
      if (sessions.size >= MAX_SESSIONS) {
        send(res, 503, { error: 'too many sessions' });
        return;
      }
    }

    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id: string): void => {
        sessions.set(id, { transport, lastSeen: Date.now() });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId !== undefined) sessions.delete(transport.sessionId);
    };

    await createServer(runtime).connect(transport as unknown as SdkTransport);
    await transport.handleRequest(req, res, parsed);
  }

  server.listen(options.port, options.host, () => {
    log.info(
      { host: options.host, port: options.port, auth: options.token !== undefined },
      'torob-mcp listening on /mcp',
    );
  });

  return server;
}

/** Reads a request body with a hard cap, destroying the socket rather than buffering past it. */
async function readBody(req: IncomingMessage): Promise<string | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      return undefined;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

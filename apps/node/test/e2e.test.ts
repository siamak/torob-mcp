/**
 * End-to-end tests against the built binary.
 *
 * These spawn the real `dist/bin.mjs`, so they cover the parts unit tests cannot: the shebang, the
 * bundle, argument parsing, stdout/stderr separation, and the HTTP transport's security controls.
 *
 * No upstream request is made - only protocol-level calls that fail before reaching Torob.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BIN = fileURLToPath(new URL('../dist/bin.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const env = { ...process.env, TOROB_LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv;

beforeAll(() => {
  if (!existsSync(BIN)) {
    throw new Error(`${BIN} is missing - run "pnpm build" before the e2e tests`);
  }
});

/** Drives the binary over stdio with raw JSON-RPC, the way a real MCP client does. */
async function stdioSession(requests: unknown[]): Promise<{ responses: unknown[]; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn('node', [BIN], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);

    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);

    setTimeout(() => {
      child.kill();
      const responses = stdout
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as unknown);
      resolve({ responses, stderr });
    }, 2500);
  });
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '0' },
  },
};
const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };

describe('stdio transport', () => {
  it('completes a tools/list round-trip', async () => {
    const { responses } = await stdioSession([
      initialize,
      initialized,
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);

    const init = responses.find((r) => (r as { id?: number }).id === 1) as {
      result: { serverInfo: { name: string } };
    };
    expect(init.result.serverInfo.name).toBe('torob-mcp');

    const list = responses.find((r) => (r as { id?: number }).id === 2) as {
      result: { tools: unknown[] };
    };
    expect(list.result.tools).toHaveLength(15);
  });

  it('completes a tools/call round-trip and keeps stdout clean', async () => {
    const { responses, stderr } = await stdioSession([
      initialize,
      initialized,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        // Rejected on the id before any request reaches Torob, so this makes no network call.
        params: { name: 'product_details', arguments: { product_id: 'not-a-uuid' } },
      },
    ]);

    const call = responses.find((r) => (r as { id?: number }).id === 2) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(call.result.isError).toBe(true);
    expect(call.result.content[0]?.text).toContain('search_torob');

    // Every line on stdout must be protocol JSON: one stray byte corrupts the transport.
    expect(responses.length).toBeGreaterThan(0);
    expect(stderr).not.toContain('{"jsonrpc"');
  });

  it('answers --version and --help on stdout without starting a server', async () => {
    const run = async (flag: string): Promise<string> =>
      await new Promise((resolve) => {
        const child = spawn('node', [BIN, flag], { cwd: ROOT, env });
        let out = '';
        child.stdout.on('data', (c: Buffer) => {
          out += c.toString();
        });
        child.on('close', () => resolve(out));
      });

    expect((await run('--version')).trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(await run('--help')).toContain('not affiliated with Torob');
  });

  it('exits non-zero on an unknown flag', async () => {
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn('node', [BIN, '--not-a-flag'], { cwd: ROOT, env });
      child.on('close', resolve);
    });
    expect(code).not.toBe(0);
  });
});

describe('http transport', () => {
  let server: ChildProcess;
  const port = 3987;
  const base = `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    server = spawn('node', [BIN, '--http', '--port', String(port)], { cwd: ROOT, env });
    // Wait for the listener rather than sleeping blind.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await fetch(`${base}/healthz`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error('http server did not start');
  });

  afterAll(() => {
    server.kill();
  });

  it('serves /healthz without touching Torob', async () => {
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('sets security headers and never a wildcard CORS header', async () => {
    const response = await fetch(`${base}/healthz`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects a foreign Origin, which is the DNS-rebinding defence', async () => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: '{}',
    });
    expect(response.status).toBe(403);
  });

  it('rejects a spoofed Host', async () => {
    // fetch refuses to set Host, so this goes down a raw socket - which is what an attacker has.
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(
          'POST /mcp HTTP/1.1\r\n' +
            'Host: attacker.test\r\n' +
            'Content-Type: application/json\r\n' +
            'Content-Length: 2\r\n' +
            'Connection: close\r\n\r\n{}',
        );
      });
      let data = '';
      socket.on('data', (chunk) => {
        data += chunk.toString();
      });
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });

    expect(raw.split('\r\n')[0]).toContain('403');
  });

  it('accepts POST only on /mcp', async () => {
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
    expect((await fetch(`${base}/admin`)).status).toBe(404);
  });

  it('rejects an invalid body', async () => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(response.status).toBe(400);
  });

  it('rejects an oversized body', async () => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(2_000_000) }),
    }).catch(() => undefined);
    // The server caps the body and may close the socket outright; either is a refusal.
    expect(response === undefined || response.status === 413).toBe(true);
  });

  it('initializes a session over Streamable HTTP', async () => {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(initialize),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('torob-mcp');
  });
});

describe('http transport refuses an unsafe bind', () => {
  it('will not bind a non-loopback address without a token', async () => {
    const { code, stderr } = await new Promise<{ code: number | null; stderr: string }>(
      (resolve) => {
        const child = spawn('node', [BIN, '--http', '--host', '0.0.0.0', '--port', '3986'], {
          cwd: ROOT,
          env: { ...env, TOROB_AUTH_TOKEN: '' },
        });
        let stderr = '';
        child.stderr.on('data', (c: Buffer) => {
          stderr += c.toString();
        });
        child.on('close', (code) => resolve({ code, stderr }));
      },
    );

    expect(code).not.toBe(0);
    expect(stderr).toContain('Refusing to bind');
    expect(stderr).toContain('--insecure');
  });
});

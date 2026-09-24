/**
 * torob-mcp entry point.
 *
 * `npx torob-mcp` speaks stdio. `--http [--port N] [--host H]` starts the Streamable HTTP
 * transport instead.
 */

import process from 'node:process';
import { parseArgs } from 'node:util';
import { SERVER_VERSION } from '@torob-mcp/core';
import { loadEnv } from './config.ts';
import { createLogger, createRuntime } from './runtime.ts';
import { startHttp } from './transports/http.ts';
import { startStdio } from './transports/stdio.ts';

const USAGE = `torob-mcp ${SERVER_VERSION} - unofficial MCP server for torob.com

  torob-mcp                     speak MCP over stdio (default)
  torob-mcp --http              serve Streamable HTTP on 127.0.0.1:3000
  torob-mcp --http --port 8080  choose the port
  torob-mcp --http --host 0.0.0.0 --insecure

Flags:
  --http             enable the HTTP transport instead of stdio
  --port <n>         HTTP port (default 3000)
  --host <addr>      HTTP bind address (default 127.0.0.1)
  --insecure         allow a non-loopback bind with no auth token. Do not use this on a
                     machine reachable from the internet.
  --version, --help

Configuration is read from the environment; see .env.example.
This project is unofficial and not affiliated with Torob.`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      http: { type: 'boolean', default: false },
      port: { type: 'string' },
      host: { type: 'string' },
      insecure: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (values.help === true) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (values.version === true) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }

  const env = loadEnv(process.env);
  const log = createLogger(env.TOROB_LOG_LEVEL);
  const runtime = createRuntime(env, log);

  if (values.http !== true) {
    await startStdio(runtime);
    // stderr only: stdout is the transport.
    log.info({ version: SERVER_VERSION }, 'torob-mcp ready on stdio');
    return;
  }

  const port = values.port === undefined ? 3000 : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`--port must be a number between 1 and 65535, got ${String(values.port)}`);
  }

  const server = startHttp(runtime, log, {
    host: values.host ?? '127.0.0.1',
    port,
    token: env.TOROB_AUTH_TOKEN,
    insecure: values.insecure === true,
    allowedOrigins: env.TOROB_ALLOWED_ORIGINS,
    allowedHosts: env.TOROB_ALLOWED_HOSTS,
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  // Startup failures go to stderr and exit non-zero; never to stdout, which is the transport.
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

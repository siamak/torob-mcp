/**
 * Workers Runtime adapters for @torob-mcp/core.
 */

import {
  DEFAULT_CONFIG,
  type Logger,
  type Runtime,
} from '@torob-mcp/core';
import { createWorkerCache } from './cache.ts';
import { type WorkerBindings, type WorkerConfig, defaultUserAgent } from './config.ts';
import { createUpstreamLimiter } from './rate-limit.ts';

const LEVEL_ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export function createLogger(level: WorkerConfig['TOROB_LOG_LEVEL']): Logger {
  const min = LEVEL_ORDER[level];
  const emit = (lvl: keyof typeof LEVEL_ORDER, msg: string, fields?: Record<string, unknown>) => {
    if (LEVEL_ORDER[lvl] < min) return;
    // Structured JSON for Workers Logs. Never put raw search queries at info.
    console[lvl === 'debug' ? 'log' : lvl](
      JSON.stringify({ level: lvl, msg, ...fields, ts: new Date().toISOString() }),
    );
  };
  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}

export function createRuntime(env: WorkerBindings, config: WorkerConfig, log: Logger): Runtime {
  return {
    fetch: (request) => fetch(request),
    cache: createWorkerCache(env.CACHE_KV),
    log,
    limiter: createUpstreamLimiter(config.TOROB_RATE_PER_SEC, config.TOROB_CONCURRENCY),
    now: () => Date.now(),
    random: () => Math.random(),
    config: {
      ...DEFAULT_CONFIG,
      userAgent: config.TOROB_USER_AGENT ?? defaultUserAgent(),
      timeoutMs: config.TOROB_TIMEOUT_MS,
      maxSubrequests: config.TOROB_MAX_SUBREQUESTS,
    },
  };
}

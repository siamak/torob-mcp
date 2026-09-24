/**
 * Public surface of @torob-mcp/core.
 *
 * A host provides a Runtime and calls registerTools. Nothing else is needed, and nothing here
 * imports a platform API.
 */

export { registerTools } from './tools/index.ts';
export { DEFAULT_CONFIG, DEFAULT_TTLS } from './runtime.ts';
export type {
  Cache,
  CacheTtls,
  CoreConfig,
  Logger,
  RateLimiter,
  Runtime,
} from './runtime.ts';
export { TorobError, type Result, type TorobErrorKind } from './torob/errors.ts';
export { ALLOWED_HOSTS } from './torob/endpoints.ts';

export const SERVER_NAME = 'torob-mcp';
export const SERVER_VERSION = '0.1.0';

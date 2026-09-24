/**
 * Canonical argument keys and opaque pagination cursors.
 *
 * Upstream `next` URLs carry session and experiment identifiers (`suid`, `init_suid`,
 * `rank_offset`, `_bt__experiment`), so they are never echoed to the caller or followed verbatim.
 * A cursor here is our own state, base64url-encoded so callers treat it as opaque rather than
 * constructing one by hand.
 *
 * Encoding uses only web standards (TextEncoder, crypto.subtle, btoa), so it works unchanged
 * under workerd.
 */

import { z } from 'zod';
import { TorobError } from '../torob/errors.ts';

const CURSOR_VERSION = 1;

/**
 * Cursor state, validated on decode rather than trusted.
 *
 * A cursor is caller-supplied input that arrived through an LLM, so it gets the same treatment as
 * any other external data: parsed through zod, never cast.
 */
const CursorStateSchema = z.strictObject({
  v: z.literal(CURSOR_VERSION),
  /** Which tool minted it - a cursor from search_torob must not be spent on product_sellers. */
  t: z.string().min(1).max(64),
  /** Offset into the logical result set. */
  o: z.number().int().min(0).max(100_000),
  /** Digest of the originating arguments, so a cursor cannot silently change the query. */
  k: z.string().length(64),
});
export type CursorState = z.infer<typeof CursorStateSchema>;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Deterministic JSON for a set of arguments.
 *
 * Object keys are sorted and undefined/null members dropped, so the same logical query produces
 * the same text however the caller happened to order or pad its arguments. Arrays keep their
 * order, because for our inputs (`product_ids`) order is meaningful to the caller even when it is
 * not to the result.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return 'null';
}

/**
 * SHA-256 over the canonical form of the arguments.
 *
 * The hash must be collision-resistant, not merely short: this value keys the cache *and* binds a
 * cursor to its query, so a collision serves one query's results for another. An earlier version
 * truncated base64 of the arguments, which is a positional encoding rather than a digest - every
 * argument set sharing a prefix collapsed onto one key, and browse_category returned identical
 * results for `cheapest`, `priciest` and `most_sellers`. See docs/ARCHITECTURE.md.
 */
export async function argsKey(args: Record<string, unknown>): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(args)),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function encodeCursor(tool: string, offset: number, key: string): string {
  const state: CursorState = { v: CURSOR_VERSION, t: tool, o: offset, k: key };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(state)));
}

/**
 * Decodes a cursor, verifying it belongs to this tool and this argument set.
 *
 * A malformed, foreign or stale cursor is a caller error with an actionable message, never a crash.
 */
export function decodeCursor(cursor: string, tool: string, key: string): number {
  const reject = (detail: string): never => {
    throw new TorobError('NotFound', {
      hint: `that cursor is not valid for ${tool} - omit cursor to start from the first page`,
      detail,
    });
  };

  if (cursor.length > 512) return reject('cursor too long');

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(fromBase64Url(cursor)));
  } catch {
    return reject('cursor is not decodable');
  }

  const parsed = CursorStateSchema.safeParse(raw);
  if (!parsed.success)
    return reject(parsed.error.issues[0]?.path.join('.') ?? 'cursor failed validation');

  const state = parsed.data;
  if (state.t !== tool) return reject(`cursor belongs to ${state.t}`);
  if (state.k !== key) return reject('cursor arguments changed');

  return state.o;
}

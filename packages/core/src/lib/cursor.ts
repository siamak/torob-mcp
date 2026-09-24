/**
 * Opaque pagination cursors.
 *
 * Upstream `next` URLs carry session and experiment identifiers (`suid`, `init_suid`,
 * `rank_offset`, `_bt__experiment`), so they are never echoed to the caller or followed verbatim.
 * A cursor here is our own state, base64url-encoded so callers treat it as opaque rather than
 * constructing one by hand.
 *
 * Encoding uses only web standards (TextEncoder + btoa), so it works unchanged under workerd.
 */

import { TorobError } from '../torob/errors.ts';

const CURSOR_VERSION = 1;

export interface CursorState {
  readonly v: number;
  /** Which tool minted it — a cursor from search_torob must not be spent on product_sellers. */
  readonly t: string;
  /** Offset into the logical result set. */
  readonly o: number;
  /** Hash of the originating arguments, so a cursor cannot silently change the query. */
  readonly k: string;
}

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

  let state: unknown;
  try {
    state = JSON.parse(new TextDecoder().decode(fromBase64Url(cursor)));
  } catch {
    return reject('cursor is not decodable');
  }

  if (typeof state !== 'object' || state === null) return reject('cursor is not an object');
  const s = state as Partial<CursorState>;
  if (s.v !== CURSOR_VERSION) return reject(`cursor version ${String(s.v)}`);
  if (s.t !== tool) return reject(`cursor belongs to ${String(s.t)}`);
  if (s.k !== key) return reject('cursor arguments changed');
  if (typeof s.o !== 'number' || !Number.isSafeInteger(s.o) || s.o < 0) return reject('bad offset');

  return s.o;
}

/** Stable, order-independent key over the arguments a cursor is bound to. */
export function argsKey(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return toBase64Url(new TextEncoder().encode(JSON.stringify(entries))).slice(0, 22);
}

/**
 * Constant-time bearer check and Origin allowlist.
 */

/** Compare two UTF-8 strings in constant time (length padded). */
export function tokenMatches(provided: string, expected: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  const len = Math.max(a.byteLength, b.byteLength, 1);
  const aa = new Uint8Array(len);
  const bb = new Uint8Array(len);
  aa.set(a);
  bb.set(b);
  let diff = a.byteLength === b.byteLength ? 0 : 1;
  for (let i = 0; i < len; i += 1) {
    diff |= aa[i]! ^ bb[i]!;
  }
  return diff === 0;
}

export function bearerFrom(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

/**
 * Browser Origins must be on the allowlist. Missing Origin (stdio-style / server clients) is OK.
 * No wildcard.
 */
export function originAllowed(request: Request, allowedHosts: readonly string[]): boolean {
  const origin = request.headers.get('origin');
  if (origin === null || origin === '') return true;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (allowedHosts.length === 0) return false;
  return allowedHosts.includes(host);
}

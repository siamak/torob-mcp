/**
 * Typed upstream failures. Core never throws across the tool boundary — it returns Result<T>, and
 * exactly one place (tools/index.ts) turns a TorobError into an MCP error.
 */

export type TorobErrorKind =
  | 'NotFound'
  | 'RateLimited'
  | 'Blocked'
  | 'SchemaDrift'
  | 'Upstream'
  | 'Timeout';

export interface TorobErrorInit {
  /** What the model should do next. Actionable, never a stack trace. */
  readonly hint: string;
  readonly status?: number;
  /** Path only — never the full URL, which would carry query text into logs. */
  readonly endpoint?: string;
  /** Detail for debug logs only. Never shown to the model. */
  readonly detail?: string;
}

export class TorobError extends Error {
  readonly kind: TorobErrorKind;
  readonly hint: string;
  readonly status: number | undefined;
  readonly endpoint: string | undefined;
  readonly detail: string | undefined;

  constructor(kind: TorobErrorKind, init: TorobErrorInit) {
    super(init.hint);
    this.name = 'TorobError';
    this.kind = kind;
    this.hint = init.hint;
    this.status = init.status;
    this.endpoint = init.endpoint;
    this.detail = init.detail;
  }
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: TorobError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(error: TorobError): Result<T> => ({ ok: false, error });

export const notFound = (what: string, hint: string, endpoint?: string): TorobError =>
  new TorobError('NotFound', endpoint === undefined ? { hint, detail: what } : { hint, detail: what, endpoint });

export const isTorobError = (e: unknown): e is TorobError => e instanceof TorobError;

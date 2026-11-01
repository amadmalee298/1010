/** Shared between server actions and client hooks (no server-only imports here). */
export type ActionResult<T> =
  | { ok: true; data: T }
  /** retryable: the same request may succeed later unchanged (signed out, no open drawer, a transient error). */
  | { ok: false; error: string; fieldErrors?: Record<string, string[]>; retryable?: boolean };

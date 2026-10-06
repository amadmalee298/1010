import 'server-only';
import { DbOperationError } from './action';
import type { DbError } from './errors';

/** Unwrap a supabase-js response, throwing a typed error on failure. */
export function unwrap<T>(res: { data: T | null; error: DbError | null }): T {
  if (res.error) throw new DbOperationError(res.error);
  if (res.data === null) throw new DbOperationError({ message: 'NOT_FOUND', code: 'P0001' });
  return res.data;
}

/** Same as unwrap but allows null data (e.g. maybeSingle). */
export function unwrapMaybe<T>(res: { data: T | null; error: DbError | null }): T | null {
  if (res.error) throw new DbOperationError(res.error);
  return res.data;
}

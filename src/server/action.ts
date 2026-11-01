import 'server-only';
import { z, type ZodType } from 'zod';
import { getT } from '@/i18n/server';
import { businessCode, translateDbError, type DbError } from './errors';
import { requireEmployee, type Employee } from './auth';
import type { AppRole } from '@/lib/database.types';
import { revalidatePath } from 'next/cache';

import type { ActionResult } from './action-types';
export type { ActionResult };

export class ActionError extends Error {}

/** Thrown by repositories when Supabase returns an error. */
export class DbOperationError extends Error {
  constructor(public readonly db: DbError) {
    super(db.message);
  }
}

/**
 * Wraps a Server Action: authorises the role, validates input with zod,
 * translates database errors and optionally revalidates paths.
 */
export function defineAction<S extends ZodType, R>(options: {
  input: S;
  roles: readonly AppRole[];
  revalidate?: readonly string[];
  handler: (input: z.infer<S>, ctx: { employee: Employee }) => Promise<R>;
}): (raw: unknown) => Promise<ActionResult<R>> {
  return async (raw) => {
    const t = await getT();
    const parsed = options.input.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: t.errors.validation, fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
    }
    try {
      const employee = await requireEmployee(options.roles, { redirectOnFail: false });
      const data = await options.handler(parsed.data, { employee });
      for (const p of options.revalidate ?? []) revalidatePath(p);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof DbOperationError) return { ok: false, error: translateDbError(err.db, t), retryable: retryableDbError(err.db) };
      if (err instanceof ActionError) return { ok: false, error: err.message };
      // Signed out or session expired: signing in again makes the same request succeed.
      if (err instanceof Error && err.message === 'FORBIDDEN') return { ok: false, error: t.errors.permission, retryable: true };
      console.error('[action]', err);
      return { ok: false, error: t.errors.generic, retryable: true };
    }
  };
}

/**
 * A database error the same request can get past later: no open drawer, a lost race on an
 * idempotency key (the retry returns the existing row), a permission problem fixed by signing in
 * again, or an unexpected (transient) error. Business rule failures are final.
 */
export function retryableDbError(db: DbError): boolean {
  const code = businessCode(db);
  if (code === 'NO_OPEN_SESSION') return true;
  if (code) return false;
  if (db.code === '23514' || db.code === '22P02' || db.code === '23503') return false;
  return true;
}

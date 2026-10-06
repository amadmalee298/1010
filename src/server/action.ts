import 'server-only';
import { z, type ZodType } from 'zod';
import { getT } from '@/i18n/server';
import { translateDbError, type DbError } from './errors';
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
      if (err instanceof DbOperationError) return { ok: false, error: translateDbError(err.db, t) };
      if (err instanceof ActionError) return { ok: false, error: err.message };
      if (err instanceof Error && err.message === 'FORBIDDEN') return { ok: false, error: t.errors.permission };
      console.error('[action]', err);
      return { ok: false, error: t.errors.generic };
    }
  };
}

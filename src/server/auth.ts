import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { AppRole } from '@/lib/database.types';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { isTransientStatus } from '@/domain/http-status';

/** The sign-in could not be checked (database or network trouble), which is not the same as signed out. */
export class AuthUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('AUTH_UNAVAILABLE', { cause });
  }
}

export interface Employee {
  userId: string;
  employeeId: string;
  email: string | null;
  displayName: string;
  role: AppRole;
}

/** Current employee (or null). Cached per request. */
export const getCurrentEmployee = cache(async (): Promise<Employee | null> => {
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError && (isAuthRetryableFetchError(authError) || (authError.status ?? 0) >= 500)) throw new AuthUnavailableError(authError);
  if (!auth.user) return null;
  // Independent lookups: run them in one round trip's time.
  const [empRes, roleRes] = await Promise.all([
    supabase.from('employees').select('id, display_name, role_id, is_active').eq('user_id', auth.user.id).maybeSingle(),
    supabase.rpc('current_app_role'),
  ]);
  // A lookup that could not run (network or server trouble) says nothing about the user: do not
  // treat it as "not an employee" (→ login page). A rejected token or a permission error still means
  // "not signed in" below, so the user can sign in again instead of being stuck on /unavailable.
  for (const res of [empRes, roleRes]) {
    if (res.error && isTransientStatus(res.status)) throw new AuthUnavailableError(res.error);
  }
  const emp = empRes.data;
  const role = roleRes.data;
  if (!emp || !emp.is_active || !role) return null;
  return { userId: auth.user.id, employeeId: emp.id, email: auth.user.email ?? null, displayName: emp.display_name, role };
});

/**
 * For API routes: the current employee, null when signed out, or 'unavailable' when the sign-in
 * could not be checked (answer 503 so the client can retry instead of getting a 500 page).
 */
export async function getApiEmployee(): Promise<Employee | null | 'unavailable'> {
  try {
    return await getCurrentEmployee();
  } catch (err) {
    if (err instanceof AuthUnavailableError) return 'unavailable';
    throw err;
  }
}

/**
 * Ensure the caller is an active employee with one of `roles`.
 * Pages redirect; actions (redirectOnFail=false) throw 'FORBIDDEN'.
 * The database enforces the same rules with RLS — this is for UX and defence in depth.
 */
export async function requireEmployee(
  roles: readonly AppRole[] = ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN'],
  { redirectOnFail = true }: { redirectOnFail?: boolean } = {},
): Promise<Employee> {
  let employee: Employee | null;
  try {
    employee = await getCurrentEmployee();
  } catch (err) {
    if (err instanceof AuthUnavailableError && redirectOnFail) redirect('/unavailable');
    throw err;
  }
  if (!employee || !roles.includes(employee.role)) {
    if (!redirectOnFail) throw new Error('FORBIDDEN');
    redirect(employee ? '/forbidden' : '/login');
  }
  return employee;
}

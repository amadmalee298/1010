import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { AppRole } from '@/lib/database.types';

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
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  // Independent lookups: run them in one round trip's time.
  const [{ data: emp }, { data: role }] = await Promise.all([
    supabase.from('employees').select('id, display_name, role_id, is_active').eq('user_id', auth.user.id).maybeSingle(),
    supabase.rpc('current_app_role'),
  ]);
  if (!emp || !emp.is_active || !role) return null;
  return { userId: auth.user.id, employeeId: emp.id, email: auth.user.email ?? null, displayName: emp.display_name, role };
});

/**
 * Ensure the caller is an active employee with one of `roles`.
 * Pages redirect; actions (redirectOnFail=false) throw 'FORBIDDEN'.
 * The database enforces the same rules with RLS — this is for UX and defence in depth.
 */
export async function requireEmployee(
  roles: readonly AppRole[] = ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN'],
  { redirectOnFail = true }: { redirectOnFail?: boolean } = {},
): Promise<Employee> {
  const employee = await getCurrentEmployee();
  if (!employee || !roles.includes(employee.role)) {
    if (!redirectOnFail) throw new Error('FORBIDDEN');
    redirect(employee ? '/forbidden' : '/login');
  }
  return employee;
}

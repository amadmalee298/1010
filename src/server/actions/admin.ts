'use server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { ActionError, defineAction } from '../action';
import { ALL_ROLES, OWNER_ONLY } from '@/domain/permissions';
import { createEmployeeSchema, resetPasswordSchema, settingsSchema, updateEmployeeSchema } from '@/domain/schemas/admin';
import { getT } from '@/i18n/server';
import { unwrap } from '../db';
import type { AppRole } from '@/lib/database.types';

async function roleId(code: AppRole): Promise<string> {
  const db = await createSupabaseServerClient();
  const res = await db.from('roles').select('id').eq('code', code).single();
  const row: { id: string } = unwrap(res);
  return row.id;
}

export const createEmployeeAction = defineAction({
  input: createEmployeeSchema,
  roles: OWNER_ONLY,
  revalidate: ['/employees'],
  handler: async (input) => {
    const admin = createSupabaseAdminClient();
    if (!admin) throw new ActionError((await getT()).admin.serviceKeyMissing);
    const created = await admin.auth.admin.createUser({ email: input.email, password: input.password, email_confirm: true });
    if (created.error || !created.data.user) throw new ActionError(created.error?.message ?? 'create user failed');
    const db = await createSupabaseServerClient();   // employee row is written as the owner, through RLS + audit trigger
    const { error } = await db.from('employees').insert({
      user_id: created.data.user.id, role_id: await roleId(input.role), display_name: input.display_name, phone: input.phone ?? null,
      legal_name: input.legal_name ?? null,
    });
    if (error) {
      await admin.auth.admin.deleteUser(created.data.user.id);   // don't leave an orphan login behind
      unwrap({ data: null, error });
    }
    return { user_id: created.data.user.id };
  },
});

export const updateEmployeeAction = defineAction({
  input: updateEmployeeSchema,
  roles: OWNER_ONLY,
  revalidate: ['/employees'],
  handler: async (input) => {
    const db = await createSupabaseServerClient();
    return unwrap(await db.from('employees').update({
      display_name: input.display_name, legal_name: input.legal_name ?? null, role_id: await roleId(input.role), phone: input.phone ?? null, is_active: input.is_active,
    }).eq('id', input.id).select().single());
  },
});

export const resetPasswordAction = defineAction({
  input: resetPasswordSchema,
  roles: OWNER_ONLY,
  handler: async ({ user_id, password }) => {
    const admin = createSupabaseAdminClient();
    if (!admin) throw new ActionError((await getT()).admin.serviceKeyMissing);
    const { error } = await admin.auth.admin.updateUserById(user_id, { password });
    if (error) throw new ActionError(error.message);
    return { user_id };
  },
});

export const saveSettingsAction = defineAction({
  input: settingsSchema,
  roles: OWNER_ONLY,
  revalidate: ['/settings', '/pos'],
  handler: async (input) => {
    const db = await createSupabaseServerClient();
    const current = new Map(unwrap(await db.from('settings').select('key, value')).map((r) => [r.key, JSON.stringify(r.value)]));
    for (const [key, value] of Object.entries(input)) {
      if (current.get(key) === JSON.stringify(value)) continue;   // only real changes reach the audit log
      const { error } = await db.from('settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
      if (error) unwrap({ data: null, error });
    }
    return input;
  },
});

export const setLocaleAction = defineAction({
  input: z.object({ locale: z.enum(['th', 'en']) }),
  roles: ALL_ROLES,
  handler: async ({ locale }) => {
    (await cookies()).set('locale', locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
    return { locale };
  },
});

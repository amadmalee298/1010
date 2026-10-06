'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getT } from '@/i18n/server';
import { homePathFor } from '@/domain/permissions';

const schema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(6).max(200),
  next: z.string().startsWith('/').max(200).optional(),
});

export interface LoginState { error: string | null }

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const t = await getT();
  const parsed = schema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') || undefined,
  });
  if (!parsed.success) return { error: t.auth.invalid };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
  if (error) return { error: t.auth.invalid };

  let { data: role } = await supabase.rpc('current_app_role');
  if (!role) {
    // First-run bootstrap: succeeds only while no employees exist yet.
    const { error: claimError } = await supabase.rpc('claim_first_owner', { p_display_name: parsed.data.email.split('@')[0] ?? 'Owner' });
    if (!claimError) ({ data: role } = await supabase.rpc('current_app_role'));
  }
  if (!role) {
    await supabase.auth.signOut();
    return { error: t.auth.notEmployee };
  }
  const next = parsed.data.next && !parsed.data.next.startsWith('//') ? parsed.data.next : homePathFor(role);
  redirect(next);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}

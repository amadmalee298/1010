import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

/**
 * Service-role client — bypasses RLS. Used ONLY for Auth Admin operations
 * (creating staff accounts, resetting passwords) after the caller has been
 * verified as OWNER, and for the Telegram bot's service-role-only RPCs
 * (webhook, and bill-card notifications after a role-checked action).
 * Never import this from client components.
 */
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

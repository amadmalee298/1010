'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/** Browser client (used for realtime subscriptions and auth state). */
export function getSupabaseBrowserClient() {
  client ??= createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  );
  return client;
}

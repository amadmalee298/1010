import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import type { BillStatus, BillSubmissionRow, TelegramAccountRow } from '@/lib/database.types';
import { unwrap, unwrapMaybe } from '../db';

export async function listBills(db: SupabaseServerClient, status: BillStatus): Promise<BillSubmissionRow[]> {
  return unwrap(await db.from('bill_submissions').select('*').eq('status', status).order('created_at', { ascending: status === 'PENDING' }).limit(200));
}

export async function countPendingBills(db: SupabaseServerClient): Promise<number> {
  const { count } = await db.from('bill_submissions').select('id', { count: 'exact', head: true }).eq('status', 'PENDING');
  return count ?? 0;
}

export async function getBill(db: SupabaseServerClient, id: string): Promise<BillSubmissionRow | null> {
  return unwrapMaybe(await db.from('bill_submissions').select('*').eq('id', id).maybeSingle());
}

/** Short-lived link to the bill photo kept in Supabase Storage. */
export async function billPhotoUrl(db: SupabaseServerClient, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await db.storage.from('expense-receipts').createSignedUrl(path, 60 * 30);
  return data?.signedUrl ?? null;
}

export async function myTelegramAccount(db: SupabaseServerClient, employeeId: string): Promise<TelegramAccountRow | null> {
  const res = await db.from('telegram_accounts').select('*').eq('employee_id', employeeId).maybeSingle();
  return unwrapMaybe<TelegramAccountRow>(res);
}

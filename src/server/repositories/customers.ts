import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import type { Tables } from '@/lib/database.types';
import type { CustomerInput } from '@/domain/schemas/customers';
import { unwrap } from '../db';

export type Customer = Tables<'customers'>;

export async function searchCustomers(db: SupabaseServerClient, query: string, limit = 20): Promise<Customer[]> {
  const digits = query.replace(/\D/g, '');
  const safe = query.replace(/[%_,()]/g, '');
  let q = db.from('customers').select('*').order('total_spent', { ascending: false }).limit(limit);
  q = digits.length >= 3 ? q.like('phone', `%${digits}%`) : q.ilike('name', `%${safe}%`);
  return unwrap(await q);
}

export async function listCustomers(db: SupabaseServerClient, limit = 500): Promise<Customer[]> {
  return unwrap(await db.from('customers').select('*').order('total_spent', { ascending: false }).limit(limit));
}

export async function saveCustomer(db: SupabaseServerClient, input: CustomerInput): Promise<Customer> {
  const row = { name: input.name, phone: input.phone ?? null, email: input.email ?? null, birthday: input.birthday ?? null, note: input.note ?? null };
  return input.id
    ? unwrap(await db.from('customers').update(row).eq('id', input.id).select().single())
    : unwrap(await db.from('customers').insert(row).select().single());
}

export async function customerPointsHistory(db: SupabaseServerClient, customerId: string) {
  return unwrap(await db.from('customer_points').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(100));
}

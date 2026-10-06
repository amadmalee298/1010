import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import type { CashTxnType, PurchaseStatus, Tables, Views } from '@/lib/database.types';
import type { PurchaseOrderInput, SupplierInput } from '@/domain/schemas/operations';
import { unwrap, unwrapMaybe } from '../db';

// ---- Production ----
export type Production = Tables<'production'>;

export async function listProduction(db: SupabaseServerClient, limit = 100): Promise<Production[]> {
  return unwrap(await db.from('production').select('*').order('created_at', { ascending: false }).limit(limit));
}
export async function productionRequirements(db: SupabaseServerClient, id: string) {
  return unwrap(await db.rpc('production_requirements', { p_production_id: id }));
}
export async function createProduction(db: SupabaseServerClient, productId: string, batches: number, note?: string) {
  return unwrap(await db.rpc('create_production', { p_product_id: productId, p_batches: batches, p_note: note ?? null }));
}
export async function completeProduction(db: SupabaseServerClient, id: string, actualOutput?: number) {
  return unwrap(await db.rpc('complete_production', { p_production_id: id, p_actual_output: actualOutput ?? null }));
}
export async function cancelProduction(db: SupabaseServerClient, id: string) {
  const { error } = await db.rpc('cancel_production', { p_production_id: id });
  if (error) unwrap({ data: null, error });
}

// ---- Suppliers & purchase orders ----
export type Supplier = Tables<'suppliers'>;
export type PurchaseOrder = Tables<'purchase_orders'>;
export type PurchaseItem = Tables<'purchase_items'>;

export async function listSuppliers(db: SupabaseServerClient, { activeOnly = false } = {}): Promise<Supplier[]> {
  let q = db.from('suppliers').select('*').order('name');
  if (activeOnly) q = q.eq('is_active', true);
  return unwrap(await q);
}
export async function saveSupplier(db: SupabaseServerClient, input: SupplierInput): Promise<Supplier> {
  const row = {
    name: input.name, contact_name: input.contact_name ?? null, phone: input.phone ?? null, email: input.email ?? null,
    tax_id: input.tax_id ?? null, address: input.address ?? null, note: input.note ?? null, is_active: input.is_active,
  };
  return input.id
    ? unwrap(await db.from('suppliers').update(row).eq('id', input.id).select().single())
    : unwrap(await db.from('suppliers').insert(row).select().single());
}
export async function listPurchaseOrders(db: SupabaseServerClient, limit = 200): Promise<PurchaseOrder[]> {
  return unwrap(await db.from('purchase_orders').select('*').order('created_at', { ascending: false }).limit(limit));
}
export async function getPurchaseOrder(db: SupabaseServerClient, id: string): Promise<{ po: PurchaseOrder; items: PurchaseItem[] } | null> {
  const res = await db.from('purchase_orders').select('*').eq('id', id).maybeSingle();
  const po: PurchaseOrder | null = unwrapMaybe(res);
  if (!po) return null;
  const items = unwrap(await db.from('purchase_items').select('*').eq('purchase_order_id', id));
  return { po, items };
}
export async function savePurchaseOrder(db: SupabaseServerClient, input: PurchaseOrderInput): Promise<string> {
  return unwrap(await db.rpc('save_purchase_order', {
    p_id: input.id ?? null, p_supplier_id: input.supplier_id, p_items: input.items,
    p_expected_date: input.expected_date ?? null, p_note: input.note ?? null,
  }));
}
export async function setPurchaseStatus(db: SupabaseServerClient, id: string, status: PurchaseStatus) {
  const { error } = await db.rpc('set_purchase_order_status', { p_id: id, p_status: status });
  if (error) unwrap({ data: null, error });
}
export async function receivePurchaseOrder(
  db: SupabaseServerClient, id: string, items: { purchase_item_id: string; quantity: number; unit_cost?: number | undefined }[], paidFromDrawer: boolean,
) {
  return unwrap(await db.rpc('receive_purchase_order', { p_id: id, p_items: items, p_paid_from_drawer: paidFromDrawer }));
}

// ---- Cash sessions ----
export type CashSessionSummary = Views<'cash_session_summary'>;
export type CashTransaction = Tables<'cash_transactions'>;

export async function currentSession(db: SupabaseServerClient): Promise<CashSessionSummary | null> {
  const res = await db.from('cash_session_summary').select('*').eq('status', 'OPEN').maybeSingle();
  return unwrapMaybe(res);
}
export async function listSessions(db: SupabaseServerClient, limit = 60): Promise<CashSessionSummary[]> {
  return unwrap(await db.from('cash_session_summary').select('*').order('opened_at', { ascending: false }).limit(limit));
}
export async function sessionTransactions(db: SupabaseServerClient, sessionId: string): Promise<CashTransaction[]> {
  return unwrap(await db.from('cash_transactions').select('*').eq('cash_session_id', sessionId).order('created_at', { ascending: false }));
}
export async function openSession(db: SupabaseServerClient, openingCash: number, note?: string) {
  return unwrap(await db.rpc('open_cash_session', { p_opening_cash: openingCash, p_note: note ?? null }));
}
export async function cashMovement(db: SupabaseServerClient, type: Extract<CashTxnType, 'DEPOSIT' | 'WITHDRAWAL'>, amount: number, note: string) {
  return unwrap(await db.rpc('cash_movement', { p_type: type, p_amount: amount, p_note: note }));
}
export async function closeSession(db: SupabaseServerClient, actualCash: number, note?: string) {
  return unwrap(await db.rpc('close_cash_session', { p_actual_cash: actualCash, p_note: note ?? null }));
}

// ---- Expenses ----
export type Expense = Tables<'expenses'>;
export async function listExpenses(db: SupabaseServerClient, from: string, to: string): Promise<Expense[]> {
  return unwrap(await db.from('expenses').select('*').gte('expense_date', from).lte('expense_date', to).order('expense_date', { ascending: false }).order('created_at', { ascending: false }));
}

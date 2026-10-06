import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import type { InventoryTxnType, Tables, Views } from '@/lib/database.types';
import { unwrap, unwrapMaybe } from '../db';

export type StockLevel = Views<'stock_levels'>;
export type InventoryTransaction = Tables<'inventory_transactions'>;

export async function listStockLevels(db: SupabaseServerClient): Promise<StockLevel[]> {
  return unwrap(await db.from('stock_levels').select('*').eq('is_active', true).order('is_low', { ascending: false }).order('name_th'));
}

export async function listTransactions(
  db: SupabaseServerClient,
  { ingredientId, type, limit = 200 }: { ingredientId?: string | undefined; type?: InventoryTxnType | undefined; limit?: number } = {},
): Promise<InventoryTransaction[]> {
  let q = db.from('inventory_transactions').select('*').order('created_at', { ascending: false }).limit(limit);
  if (ingredientId) q = q.eq('ingredient_id', ingredientId);
  if (type) q = q.eq('transaction_type', type);
  return unwrap(await q);
}

export async function adjustStock(db: SupabaseServerClient, i: { ingredient_id: string; delta: number; unit_cost?: number | undefined; note: string }) {
  return unwrap(await db.rpc('adjust_stock', { p_ingredient_id: i.ingredient_id, p_delta: i.delta, p_unit_cost: i.unit_cost ?? null, p_note: i.note }));
}

export async function recordStockCount(db: SupabaseServerClient, i: { ingredient_id: string; counted: number; note?: string | undefined }) {
  return unwrapMaybe(await db.rpc('record_stock_count', { p_ingredient_id: i.ingredient_id, p_counted: i.counted, p_note: i.note ?? null }));
}

export async function recordWaste(db: SupabaseServerClient, i: { ingredient_id: string; quantity: number; reason: string }) {
  return unwrap(await db.rpc('record_waste', { p_ingredient_id: i.ingredient_id, p_quantity: i.quantity, p_reason: i.reason }));
}

export async function integrityIssues(db: SupabaseServerClient) {
  return unwrap(await db.rpc('check_inventory_integrity'));
}

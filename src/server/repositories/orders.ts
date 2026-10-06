import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import type { Json, OrderStatus, Tables, Views } from '@/lib/database.types';
import { orderDocumentSchema, quoteResultSchema, type CreateOrderInput, type OrderDocument, type QuoteResult } from '@/domain/schemas/orders';
import type { z } from 'zod';
import type { quoteOrderSchema } from '@/domain/schemas/orders';
import { unwrap } from '../db';

export type OrderRow = Tables<'orders'>;
export type KitchenTicket = Views<'kitchen_queue'>;

const toDoc = (json: Json): OrderDocument => orderDocumentSchema.parse(json);

export async function quoteOrder(db: SupabaseServerClient, input: z.infer<typeof quoteOrderSchema>): Promise<QuoteResult> {
  return quoteResultSchema.parse(unwrap(await db.rpc('quote_order', { p_payload: input as unknown as Json })));
}

export async function createOrder(db: SupabaseServerClient, input: CreateOrderInput): Promise<OrderDocument> {
  return toDoc(unwrap(await db.rpc('create_order', { p_payload: input as unknown as Json })));
}

export async function getOrder(db: SupabaseServerClient, id: string): Promise<OrderDocument | null> {
  const res = await db.rpc('get_order', { p_order_id: id });
  if (!res.error && res.data === null) return null;
  return toDoc(unwrap(res));
}

export async function cancelOrder(db: SupabaseServerClient, id: string, reason: string): Promise<OrderDocument> {
  return toDoc(unwrap(await db.rpc('cancel_order', { p_order_id: id, p_reason: reason })));
}

export async function refundOrder(
  db: SupabaseServerClient,
  input: { order_id: string; reason: string; method: 'CASH' | 'QR' | 'TRANSFER' | 'CARD'; restock: boolean; items: { order_item_id: string; quantity: number }[] },
): Promise<OrderDocument> {
  return toDoc(unwrap(await db.rpc('refund_order', {
    p_order_id: input.order_id, p_items: input.items, p_reason: input.reason, p_method: input.method, p_restock: input.restock,
  })));
}

export async function listOrders(
  db: SupabaseServerClient,
  { date, status, search }: { date: string; status?: OrderStatus | undefined; search?: string | undefined },
): Promise<OrderRow[]> {
  let q = db.from('orders').select('*').eq('business_date', date).order('queue_number', { ascending: false });
  if (status) q = q.eq('status', status);
  if (search) q = q.ilike('order_number', `%${search.replace(/[%_]/g, '')}%`);
  return unwrap(await q);
}

export async function listKitchenQueue(db: SupabaseServerClient): Promise<KitchenTicket[]> {
  return unwrap(await db.from('kitchen_queue').select('*').order('created_at'));
}

export async function setKitchenStatus(db: SupabaseServerClient, id: string, status: 'PENDING' | 'PREPARING' | 'READY' | 'SERVED'): Promise<void> {
  const { error } = await db.rpc('set_kitchen_status', { p_order_id: id, p_status: status });
  if (error) unwrap({ data: null, error });
}

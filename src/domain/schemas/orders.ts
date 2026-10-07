import { z } from 'zod';
import { money, optionalText, optionalUuid, positiveMoney, quantity, requiredText, uuid } from './common';

export const paymentMethod = z.enum(['CASH', 'QR', 'TRANSFER', 'CARD']);

export const createOrderSchema = z.object({
  client_ref: uuid,
  order_type: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']).default('TAKEAWAY'),
  table_label: optionalText(40),
  note: optionalText(500),
  customer_id: optionalUuid,
  promotion_id: optionalUuid,
  promo_code: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,30}$/).optional()),
  manual_discount: money.default(0),
  redeem_points: z.coerce.number().int().min(0).max(1_000_000).default(0),
  items: z.array(z.object({ product_id: uuid, quantity: z.coerce.number().int().min(1).max(999), note: optionalText(200) })).min(1).max(200),
  payments: z.array(z.object({
    method: paymentMethod,
    amount: positiveMoney,
    tendered: money.optional(),
    reference: optionalText(100),
  })).max(10),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const quoteOrderSchema = createOrderSchema.omit({ client_ref: true, payments: true, order_type: true, table_label: true, note: true });

export const cancelOrderSchema = z.object({ order_id: uuid, reason: requiredText(300) });
export const refundOrderSchema = z.object({
  order_id: uuid,
  reason: requiredText(300),
  method: paymentMethod,
  restock: z.boolean().default(false),
  items: z.array(z.object({ order_item_id: uuid, quantity: z.coerce.number().int().min(1) })).min(1),
});

export const stockAdjustSchema = z.object({ ingredient_id: uuid, delta: z.coerce.number().finite().refine((v) => v !== 0), unit_cost: money.optional(), note: requiredText(300) });
export const stockCountSchema = z.object({ ingredient_id: uuid, counted: z.coerce.number().finite().min(0), note: optionalText(300) });
export const wasteSchema = z.object({ ingredient_id: uuid, quantity, reason: requiredText(300) });

// ---- Order document returned by the database (validated at the boundary) ----
const num = z.coerce.number();
export const orderDocumentSchema = z.object({
  id: uuid,
  order_number: z.string(),
  queue_number: z.number(),
  business_date: z.string(),
  status: z.enum(['COMPLETED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED']),
  kitchen_status: z.enum(['PENDING', 'PREPARING', 'READY', 'SERVED']),
  order_type: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']),
  table_label: z.string().nullable(),
  subtotal: num, promotion_discount: num, manual_discount: num, points_redeemed: num, points_discount: num,
  vat_amount: num, total: num, refunded_total: num, cogs_total: num, points_earned: num,
  note: z.string().nullable(),
  cancel_reason: z.string().nullable(),
  created_at: z.string(),
  duplicate: z.boolean().optional(),
  cashier_name: z.string().nullable(),
  customer: z.object({ id: uuid, name: z.string(), phone: z.string().nullable(), points_balance: num }).nullable(),
  items: z.array(z.object({
    id: uuid, product_id: uuid.nullable(), product_name: z.string(), quantity: num, unit_price: num, line_total: num,
    unit_cost: num, cogs_total: num, refunded_quantity: num, note: z.string().nullable(),
  })),
  payments: z.array(z.object({ method: paymentMethod, amount: num, tendered: num.nullable(), change_amount: num, reference: z.string().nullable() })),
  refunds: z.array(z.object({ refund_number: z.string(), amount: num, method: paymentMethod, reason: z.string(), restock: z.boolean(), created_at: z.string() })),
});
export type OrderDocument = z.infer<typeof orderDocumentSchema>;

export const quoteResultSchema = z.object({
  subtotal: num, promotion_discount: num, manual_discount: num, points_redeemed: num, points_discount: num,
  vat_amount: num, total: num, points_earned: num, promotion_name: z.string().nullable(),
});
export type QuoteResult = z.infer<typeof quoteResultSchema>;

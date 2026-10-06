import { z } from 'zod';
import { checkbox, money, nonNegativeQty, optionalText, optionalUuid, positiveMoney, quantity, requiredText, uuid } from './common';
import { paymentMethod } from './orders';

// ---- Production ----
export const createProductionSchema = z.object({ product_id: uuid, batches: quantity.max(10_000), note: optionalText(300) });
export const completeProductionSchema = z.object({
  production_id: uuid,
  actual_output: z.preprocess((v) => (v === '' || v === null ? undefined : v), quantity.optional()),
});
export const productionIdSchema = z.object({ production_id: uuid });

// ---- Suppliers & purchasing ----
export const supplierSchema = z.object({
  id: optionalUuid,
  name: requiredText(150),
  contact_name: optionalText(100),
  phone: optionalText(30),
  email: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().email().optional()),
  tax_id: optionalText(20),
  address: optionalText(300),
  note: optionalText(500),
  is_active: checkbox.default(true),
});
export type SupplierInput = z.infer<typeof supplierSchema>;

export const purchaseOrderSchema = z.object({
  id: optionalUuid,
  supplier_id: uuid,
  expected_date: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  note: optionalText(500),
  items: z.array(z.object({ ingredient_id: uuid, quantity, unit_cost: money })).min(1).max(100),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

export const purchaseStatusSchema = z.object({ id: uuid, status: z.enum(['ORDERED', 'CANCELLED']) });
export const receivePurchaseSchema = z.object({
  id: uuid,
  paid_from_drawer: z.boolean().default(false),
  items: z.array(z.object({ purchase_item_id: uuid, quantity: nonNegativeQty, unit_cost: money.optional() })).min(1),
});

// ---- Cash sessions ----
export const openSessionSchema = z.object({ opening_cash: money, note: optionalText(300) });
export const cashMovementSchema = z.object({ type: z.enum(['DEPOSIT', 'WITHDRAWAL']), amount: positiveMoney, note: requiredText(300) });
export const closeSessionSchema = z.object({ actual_cash: money, note: optionalText(300) });

// ---- Expenses ----
export const EXPENSE_CATEGORIES = ['ค่าเช่า', 'ค่าแรง', 'ค่าน้ำ/ไฟ', 'บรรจุภัณฑ์', 'ค่าขนส่ง', 'การตลาด', 'ซ่อมบำรุง', 'ค่าธรรมเนียม', 'อื่น ๆ'] as const;
export const expenseSchema = z.object({
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: requiredText(60),
  description: requiredText(300),
  amount: positiveMoney,
  payment_method: paymentMethod.default('CASH'),
  from_drawer: checkbox.default(false),
  supplier_id: optionalUuid,
});
export const voidExpenseSchema = z.object({ id: uuid, reason: requiredText(300) });

/** Bills of cash for the closing count. */
export const DENOMINATIONS = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;
export function countDenominations(counts: Partial<Record<(typeof DENOMINATIONS)[number], number>>): number {
  return DENOMINATIONS.reduce((sum, d) => sum + d * Math.max(0, Math.floor(counts[d] ?? 0)), 0);
}

'use server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { defineAction } from '../action';
import { FRONT_OF_HOUSE, MANAGEMENT, OWNER_ONLY } from '@/domain/permissions';
import {
  cashMovementSchema, closeSessionSchema, completeProductionSchema, createProductionSchema, expenseSchema, openSessionSchema,
  productionIdSchema, purchaseOrderSchema, purchaseStatusSchema, receivePurchaseSchema, supplierSchema, voidExpenseSchema,
} from '@/domain/schemas/operations';
import * as ops from '../repositories/operations';
import { unwrap } from '../db';

const stockPaths = ['/production', '/inventory', '/pos', '/ingredients', '/recipes'];

export const createProductionAction = defineAction({
  input: createProductionSchema, roles: MANAGEMENT, revalidate: ['/production'],
  handler: async ({ product_id, batches, note }) => ({ id: await ops.createProduction(await createSupabaseServerClient(), product_id, batches, note) }),
});
export const completeProductionAction = defineAction({
  input: completeProductionSchema, roles: MANAGEMENT, revalidate: stockPaths,
  handler: async ({ production_id, actual_output }) => ops.completeProduction(await createSupabaseServerClient(), production_id, actual_output),
});
export const cancelProductionAction = defineAction({
  input: productionIdSchema, roles: MANAGEMENT, revalidate: ['/production'],
  handler: async ({ production_id }) => { await ops.cancelProduction(await createSupabaseServerClient(), production_id); return { production_id }; },
});
export const productionRequirementsAction = defineAction({
  input: productionIdSchema, roles: MANAGEMENT,
  handler: async ({ production_id }) => ops.productionRequirements(await createSupabaseServerClient(), production_id),
});

export const saveSupplierAction = defineAction({
  input: supplierSchema, roles: MANAGEMENT, revalidate: ['/suppliers', '/purchasing'],
  handler: async (input) => ops.saveSupplier(await createSupabaseServerClient(), input),
});
export const savePurchaseOrderAction = defineAction({
  input: purchaseOrderSchema, roles: MANAGEMENT, revalidate: ['/purchasing'],
  handler: async (input) => ({ id: await ops.savePurchaseOrder(await createSupabaseServerClient(), input) }),
});
export const setPurchaseStatusAction = defineAction({
  input: purchaseStatusSchema, roles: MANAGEMENT, revalidate: ['/purchasing'],
  handler: async ({ id, status }) => { await ops.setPurchaseStatus(await createSupabaseServerClient(), id, status); return { id, status }; },
});
export const receivePurchaseAction = defineAction({
  input: receivePurchaseSchema, roles: MANAGEMENT, revalidate: ['/purchasing', ...stockPaths, '/cash'],
  handler: async ({ id, items, paid_from_drawer }) =>
    ops.receivePurchaseOrder(await createSupabaseServerClient(), id, items.filter((i) => i.quantity > 0), paid_from_drawer),
});

export const openSessionAction = defineAction({
  input: openSessionSchema, roles: FRONT_OF_HOUSE, revalidate: ['/cash', '/pos'],
  handler: async ({ opening_cash, note }) => ops.openSession(await createSupabaseServerClient(), opening_cash, note),
});
export const cashMovementAction = defineAction({
  input: cashMovementSchema, roles: FRONT_OF_HOUSE, revalidate: ['/cash'],
  handler: async ({ type, amount, note }) => ops.cashMovement(await createSupabaseServerClient(), type, amount, note),
});
export const closeSessionAction = defineAction({
  input: closeSessionSchema, roles: FRONT_OF_HOUSE, revalidate: ['/cash', '/pos'],
  handler: async ({ actual_cash, note }) => ops.closeSession(await createSupabaseServerClient(), actual_cash, note),
});

export const recordExpenseAction = defineAction({
  input: expenseSchema, roles: MANAGEMENT, revalidate: ['/expenses', '/cash', '/dashboard'],
  handler: async (i) => unwrap(await (await createSupabaseServerClient()).rpc('record_expense', {
    p_expense_date: i.expense_date, p_category: i.category, p_description: i.description, p_amount: i.amount,
    p_payment_method: i.payment_method, p_from_drawer: i.from_drawer, p_supplier_id: i.supplier_id ?? null,
  })),
});
export const voidExpenseAction = defineAction({
  input: voidExpenseSchema, roles: OWNER_ONLY, revalidate: ['/expenses', '/cash'],
  handler: async ({ id, reason }) => unwrap(await (await createSupabaseServerClient()).rpc('void_expense', { p_id: id, p_reason: reason })),
});

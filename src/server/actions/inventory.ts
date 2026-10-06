'use server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { defineAction } from '../action';
import { FRONT_OF_HOUSE, MANAGEMENT } from '@/domain/permissions';
import { stockAdjustSchema, stockCountSchema, wasteSchema } from '@/domain/schemas/orders';
import * as inventory from '../repositories/inventory';

const paths = ['/inventory', '/ingredients', '/pos', '/recipes'];

export const adjustStockAction = defineAction({
  input: stockAdjustSchema, roles: MANAGEMENT, revalidate: paths,
  handler: async (input) => inventory.adjustStock(await createSupabaseServerClient(), input),
});

export const stockCountAction = defineAction({
  input: stockCountSchema, roles: MANAGEMENT, revalidate: paths,
  handler: async (input) => inventory.recordStockCount(await createSupabaseServerClient(), input),
});

export const recordWasteAction = defineAction({
  input: wasteSchema, roles: FRONT_OF_HOUSE, revalidate: paths,
  handler: async (input) => inventory.recordWaste(await createSupabaseServerClient(), input),
});

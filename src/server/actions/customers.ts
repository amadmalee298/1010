'use server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { defineAction } from '../action';
import { FRONT_OF_HOUSE } from '@/domain/permissions';
import { customerSchema, customerSearchSchema } from '@/domain/schemas/customers';
import * as customers from '../repositories/customers';
import { MANAGEMENT } from '@/domain/permissions';
import { pointsAdjustSchema, promotionSchema } from '@/domain/schemas/customers';
import { unwrap } from '../db';
import { savePromotion } from '../repositories/promotions';

export const searchCustomersAction = defineAction({
  input: customerSearchSchema,
  roles: FRONT_OF_HOUSE,
  handler: async ({ query }) => customers.searchCustomers(await createSupabaseServerClient(), query, 10),
});

export const saveCustomerAction = defineAction({
  input: customerSchema,
  roles: FRONT_OF_HOUSE,
  revalidate: ['/customers'],
  handler: async (input) => customers.saveCustomer(await createSupabaseServerClient(), input),
});


export const adjustPointsAction = defineAction({
  input: pointsAdjustSchema,
  roles: MANAGEMENT,
  revalidate: ['/customers'],
  handler: async ({ customer_id, change, note }) =>
    unwrap(await (await createSupabaseServerClient()).rpc('adjust_customer_points', { p_customer_id: customer_id, p_change: change, p_note: note })),
});

export const savePromotionAction = defineAction({
  input: promotionSchema,
  roles: MANAGEMENT,
  revalidate: ['/promotions', '/pos'],
  handler: async (input) => savePromotion(await createSupabaseServerClient(), input),
});

'use server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { defineAction } from '../action';
import { FRONT_OF_HOUSE, MANAGEMENT } from '@/domain/permissions';
import { cancelOrderSchema, createOrderSchema, quoteOrderSchema, refundOrderSchema } from '@/domain/schemas/orders';
import * as orders from '../repositories/orders';

export const quoteOrderAction = defineAction({
  input: quoteOrderSchema,
  roles: FRONT_OF_HOUSE,
  handler: async (input) => orders.quoteOrder(await createSupabaseServerClient(), input),
});

export const createOrderAction = defineAction({
  input: createOrderSchema,
  roles: FRONT_OF_HOUSE,
  revalidate: ['/orders', '/cash'],
  handler: async (input) => orders.createOrder(await createSupabaseServerClient(), input),
});

export const cancelOrderAction = defineAction({
  input: cancelOrderSchema,
  roles: MANAGEMENT,
  revalidate: ['/orders', '/cash', '/inventory'],
  handler: async ({ order_id, reason }) => orders.cancelOrder(await createSupabaseServerClient(), order_id, reason),
});

export const refundOrderAction = defineAction({
  input: refundOrderSchema,
  roles: MANAGEMENT,
  revalidate: ['/orders', '/cash', '/inventory'],
  handler: async (input) => orders.refundOrder(await createSupabaseServerClient(), input),
});

export const getOrderAction = defineAction({
  input: cancelOrderSchema.pick({ order_id: true }),
  roles: FRONT_OF_HOUSE,
  handler: async ({ order_id }) => orders.getOrder(await createSupabaseServerClient(), order_id),
});

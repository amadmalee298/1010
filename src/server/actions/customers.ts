'use server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { defineAction } from '../action';
import { FRONT_OF_HOUSE } from '@/domain/permissions';
import { customerSchema, customerSearchSchema } from '@/domain/schemas/customers';
import * as customers from '../repositories/customers';

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

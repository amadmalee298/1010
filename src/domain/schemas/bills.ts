import { z } from 'zod';
import { checkbox, optionalText, optionalUuid, positiveMoney, requiredText, uuid } from './common';
import { paymentMethod } from './orders';

const optionalQty = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().finite().positive().max(100_000_000).optional());

export const approveBillLineSchema = z.object({
  description: requiredText(200),
  amount: positiveMoney,
  ingredient_id: optionalUuid,
  quantity: optionalQty,
}).refine((l) => !l.ingredient_id || l.quantity !== undefined, { message: 'quantity is required for stock lines', path: ['quantity'] });

export const approveBillSchema = z.object({
  id: uuid,
  bill_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vendor: optionalText(150),
  category: z.string().trim().max(60).default(''),
  payment_method: paymentMethod.default('CASH'),
  from_drawer: checkbox,
  lines: z.array(approveBillLineSchema).min(1).max(100),
});
export type ApproveBillInput = z.infer<typeof approveBillSchema>;

export const rejectBillSchema = z.object({ id: uuid, reason: requiredText(300) });
export const billIdSchema = z.object({ id: uuid });

import { z } from 'zod';
import { checkbox, optionalText, optionalUuid, positiveMoney, requiredText, uuid } from './common';
import { paymentMethod } from './orders';

const optionalQty = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().finite().positive().max(100_000_000).optional());

export const approveBillLineSchema = z.object({
  description: requiredText(200),
  amount: positiveMoney,
  ingredient_id: optionalUuid,
  quantity: optionalQty,
  note: optionalText(200),
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

export const editSubstituteSchema = z.object({
  id: uuid,
  bill_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payer_name: requiredText(150),
  approver_name: optionalText(150),
  lines: z.array(z.object({ description: requiredText(200), note: optionalText(200) })).min(1).max(100),
});
export const voidBillSchema = z.object({ id: uuid, reason: requiredText(300) });
export const attachmentSchema = z.object({
  bill_id: uuid,
  kind: z.enum(['SLIP', 'EVIDENCE', 'OTHER']),
  path: z.string().regex(/^bills\/[A-Za-z0-9/_.-]+$/).max(300),
});

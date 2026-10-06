import { z } from 'zod';
import { optionalText, optionalUuid, requiredText } from './common';

export const thaiPhone = z.string().transform((v) => v.replace(/\D/g, '')).pipe(z.string().regex(/^0\d{8,9}$/));

export const customerSchema = z.object({
  id: optionalUuid,
  name: requiredText(150),
  phone: z.preprocess((v) => (v === '' ? undefined : v), thaiPhone.optional()),
  email: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().email().max(200).optional()),
  birthday: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  note: optionalText(500),
});
export type CustomerInput = z.infer<typeof customerSchema>;
export const customerSearchSchema = z.object({ query: z.string().trim().min(1).max(50) });

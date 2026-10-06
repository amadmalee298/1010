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

export const pointsAdjustSchema = z.object({
  customer_id: z.string().uuid(),
  change: z.coerce.number().int().refine((v) => v !== 0 && Math.abs(v) <= 100_000, 'invalid change'),
  note: requiredText(300),
});

const optionalMoney = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().positive().max(1_000_000).optional());
const optionalDateTime = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().min(10).max(40).optional());

export const promotionSchema = z.object({
  id: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
  name: requiredText(100),
  code: z.preprocess((v) => (v === '' ? undefined : typeof v === 'string' ? v.trim().toUpperCase() : v), z.string().regex(/^[A-Z0-9_-]{2,30}$/).optional()),
  discount_type: z.enum(['PERCENT', 'FIXED']),
  value: z.coerce.number().positive().max(1_000_000),
  min_subtotal: z.coerce.number().min(0).max(1_000_000).default(0),
  max_discount: optionalMoney,
  members_only: z.preprocess((v) => v === true || v === 'on', z.boolean()),
  starts_at: optionalDateTime,
  ends_at: optionalDateTime,
  is_active: z.preprocess((v) => v === true || v === 'on', z.boolean()),
}).refine((p) => p.discount_type !== 'PERCENT' || p.value <= 100, { message: '≤ 100%', path: ['value'] })
  .refine((p) => !p.starts_at || !p.ends_at || p.starts_at < p.ends_at, { message: 'end after start', path: ['ends_at'] });
export type PromotionInput = z.infer<typeof promotionSchema>;

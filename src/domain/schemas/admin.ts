import { z } from 'zod';
import { optionalText, requiredText, uuid } from './common';

const role = z.enum(['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN']);
const password = z.string().min(8).max(72);

export const createEmployeeSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password,
  display_name: requiredText(100),
  role,
  phone: optionalText(30),
});
export const updateEmployeeSchema = z.object({
  id: uuid,
  display_name: requiredText(100),
  role,
  phone: optionalText(30),
  is_active: z.preprocess((v) => v === true || v === 'on', z.boolean()),
});
export const resetPasswordSchema = z.object({ user_id: uuid, password });

const bool = z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean());
export const settingsSchema = z.object({
  shop_name: requiredText(100),
  shop_address: z.string().trim().max(300).default(''),
  shop_phone: z.string().trim().max(30).default(''),
  tax_id: z.string().trim().regex(/^(\d{13})?$/, '13 digits').default(''),
  receipt_footer: z.string().trim().max(200).default(''),
  vat_enabled: bool,
  vat_rate: z.coerce.number().min(0).max(30),
  vat_inclusive: bool,
  promptpay_id: z.string().trim().transform((v) => v.replace(/\D/g, '')).pipe(z.string().regex(/^(0\d{9}|\d{13}|\d{15})?$/, 'PromptPay ID')),
  max_cashier_discount: z.coerce.number().min(0).max(100_000),
  baht_per_point: z.coerce.number().min(0).max(100_000),
  point_value: z.coerce.number().min(0).max(1000),
  min_redeem_points: z.coerce.number().int().min(0).max(1_000_000),
});
export type SettingsInput = z.infer<typeof settingsSchema>;

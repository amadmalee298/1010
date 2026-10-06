import { z } from 'zod';

export const uuid = z.string().uuid();
export const optionalUuid = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().uuid().optional());
export const optionalText = (max = 500) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());
export const requiredText = (max = 150) => z.string().trim().min(1).max(max);
/** Money in THB: ≥ 0, max 2 decimals. Accepts numeric strings from forms. */
export const money = z.coerce.number().finite().min(0).max(10_000_000).refine((v) => Math.round(v * 100) === v * 100 || Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'max 2 decimals');
export const positiveMoney = money.refine((v) => v > 0, 'must be > 0');
/** Quantity in base unit: > 0, up to 4 decimals. */
export const quantity = z.coerce.number().finite().positive().max(100_000_000);
export const nonNegativeQty = z.coerce.number().finite().min(0).max(100_000_000);
export const checkbox = z.preprocess((v) => v === true || v === 'on' || v === 'true' || v === '1', z.boolean());

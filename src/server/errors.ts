import type { Dictionary } from '@/i18n';

/**
 * Business errors raised by database functions use `raise exception '<CODE>' using detail = '...'`.
 * This maps them (and common Postgres error codes) to translated messages.
 */
export const BUSINESS_ERROR_CODES = [
  'INSUFFICIENT_STOCK', 'NO_OPEN_SESSION', 'SESSION_ALREADY_OPEN', 'PAYMENT_MISMATCH', 'INVALID_STATE',
  'PROMOTION_INVALID', 'POINTS_INVALID', 'DISCOUNT_LIMIT', 'NOT_FOUND', 'VALIDATION', 'NO_ACTIVE_RECIPE',
] as const;
export type BusinessErrorCode = (typeof BUSINESS_ERROR_CODES)[number];

export interface DbError { code?: string; message: string; details?: string | null; hint?: string | null }

export function businessCode(err: DbError): BusinessErrorCode | null {
  const head = err.message.split(':')[0]?.trim() ?? '';
  return (BUSINESS_ERROR_CODES as readonly string[]).includes(head) ? (head as BusinessErrorCode) : null;
}

export function translateDbError(err: DbError, t: Dictionary): string {
  const code = businessCode(err);
  const detail = err.details ? ` (${err.details})` : '';
  switch (code) {
    case 'INSUFFICIENT_STOCK': return t.errors.insufficientStock + detail;
    case 'NO_OPEN_SESSION': return t.errors.noOpenSession;
    case 'NOT_FOUND': return t.errors.notFound;
    case null: break;
    default: return `${t.errors.validation}${detail || ` (${code})`}`;
  }
  if (err.code === '42501') return t.errors.permission;
  if (err.code === '23505') return t.errors.duplicate;
  if (err.code === '23514' || err.code === '22P02' || err.code === '23503') return t.errors.validation;
  return t.errors.generic;
}

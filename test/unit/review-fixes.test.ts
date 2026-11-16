import { describe, expect, it } from 'vitest';
import { checkPayments } from '@/domain/payments';
import { stockAdjustSchema } from '@/domain/schemas/orders';

describe('checkPayments amounts', () => {
  it('rejects amounts with more than 2 decimals and accepts float noise', () => {
    expect(checkPayments(10.005, [{ method: 'TRANSFER', amount: 10.005 }]).error).toBe('INVALID_AMOUNT');
    expect(checkPayments(0.3, [{ method: 'CASH', amount: 0.1 + 0.2 }]).valid).toBe(true);
    expect(checkPayments(59.9, [{ method: 'CASH', amount: 59.9 }]).valid).toBe(true);
  });
});

describe('unit cost per base unit', () => {
  const base = { ingredient_id: '00000000-0000-4000-8000-000000000000', delta: '1000', note: 'ยอดยกมา' };
  it('accepts up to 4 decimals (salt 12 THB / 1000 g)', () => {
    expect(stockAdjustSchema.safeParse({ ...base, unit_cost: '0.012' }).success).toBe(true);
    expect(stockAdjustSchema.safeParse({ ...base, unit_cost: '0.0125' }).success).toBe(true);
  });
  it('rejects more than 4 decimals or negatives', () => {
    expect(stockAdjustSchema.safeParse({ ...base, unit_cost: '0.00125' }).success).toBe(false);
    expect(stockAdjustSchema.safeParse({ ...base, unit_cost: '-1' }).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { checkPayments } from '@/domain/payments';

describe('checkPayments amounts', () => {
  it('rejects amounts with more than 2 decimals and accepts float noise', () => {
    expect(checkPayments(10.005, [{ method: 'TRANSFER', amount: 10.005 }]).error).toBe('INVALID_AMOUNT');
    expect(checkPayments(0.3, [{ method: 'CASH', amount: 0.1 + 0.2 }]).valid).toBe(true);
    expect(checkPayments(59.9, [{ method: 'CASH', amount: 59.9 }]).valid).toBe(true);
  });
});

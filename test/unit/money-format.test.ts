import { describe, expect, it } from 'vitest';
import { formatAmount, formatQty, formatUnitCost, round2, sumBaht } from '@/domain/money';

describe('formatUnitCost', () => {
  it('keeps sub-satang costs instead of showing 0.00', () => {
    expect(formatUnitCost(0.012)).toBe('0.012');
    expect(formatUnitCost(0.0035)).toBe('0.0035');
    expect(formatUnitCost(0.003)).toBe('0.003');
  });
  it('shows at least 2 and at most 4 decimals', () => {
    expect(formatUnitCost(4)).toBe('4.00');
    expect(formatUnitCost(36.8081)).toBe('36.8081');
    expect(formatUnitCost(0.12345)).toBe('0.1235');
    expect(formatUnitCost(1234.5)).toBe('1,234.50');
  });
  it('differs from formatAmount only below a satang', () => {
    expect(formatAmount(0.012)).toBe('0.01');
    expect(formatUnitCost(2.33)).toBe(formatAmount(2.33));
  });
});

describe('formatQty', () => {
  it('formats with the requested precision (cached formatters)', () => {
    expect(formatQty(1.23456)).toBe('1.235');
    expect(formatQty(1.23456, 1)).toBe('1.2');
    expect(formatQty(1.23456)).toBe('1.235');
  });
});

describe('line costs add up', () => {
  it('total is the sum of the rounded lines', () => {
    const lines = [0.005, 0.005, 0.005].map(round2);
    expect(lines).toEqual([0.01, 0.01, 0.01]);
    expect(sumBaht(lines)).toBe(0.03);
  });
});

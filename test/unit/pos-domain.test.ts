import { describe, expect, it } from 'vitest';
import { priceOrder, PricingError, type PricingSettings, type PromotionRule } from '@/domain/pricing';
import { checkPayments, quickCashOptions, cashLine } from '@/domain/payments';
import { crc16, promptPayPayload, isValidPromptPayId } from '@/domain/promptpay';
import { cartReducer, emptyCart, cartItemCount } from '@/domain/cart';

const S: PricingSettings = { vatEnabled: false, vatInclusive: true, vatRate: 7, bahtPerPoint: 25, pointValue: 1, minRedeemPoints: 10 };
const promo = (p: Partial<PromotionRule> = {}): PromotionRule => ({
  id: 'p', name: 'x', discountType: 'PERCENT', value: 10, minSubtotal: 0, maxDiscount: null, membersOnly: false,
  startsAt: null, endsAt: null, isActive: true, ...p,
});
const lines = [{ productId: 'a', unitPrice: 59, quantity: 2 }, { productId: 'b', unitPrice: 199, quantity: 1 }];

describe('priceOrder', () => {
  it('sums lines', () => {
    expect(priceOrder({ lines }, S)).toMatchObject({ subtotal: 317, total: 317, pointsEarned: 0 });
  });
  it('applies percent promotion with cap, then manual discount, then points', () => {
    const r = priceOrder({ lines, promotion: promo({ maxDiscount: 25 }), manualDiscount: 12, redeemPoints: 20, customer: { pointsBalance: 30 } }, S);
    expect(r).toMatchObject({ promotionDiscount: 25, manualDiscount: 12, pointsDiscount: 20, total: 260, pointsEarned: 10 });
  });
  it('computes VAT inclusive and exclusive', () => {
    expect(priceOrder({ lines: [{ productId: 'a', unitPrice: 107, quantity: 1 }] }, { ...S, vatEnabled: true })).toMatchObject({ vatAmount: 7, total: 107 });
    expect(priceOrder({ lines: [{ productId: 'a', unitPrice: 100, quantity: 1 }] }, { ...S, vatEnabled: true, vatInclusive: false })).toMatchObject({ vatAmount: 7, total: 107 });
  });
  it('validates rules', () => {
    const err = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return (e as PricingError).code; } };
    expect(err(() => priceOrder({ lines: [] }, S))).toBe('EMPTY');
    expect(err(() => priceOrder({ lines: [{ productId: 'a', unitPrice: 1, quantity: 1.5 }] }, S))).toBe('INVALID_QUANTITY');
    expect(err(() => priceOrder({ lines, promotion: promo({ membersOnly: true }) }, S))).toBe('PROMOTION_MEMBERS_ONLY');
    expect(err(() => priceOrder({ lines, promotion: promo({ minSubtotal: 1000 }) }, S))).toBe('PROMOTION_MIN_SUBTOTAL');
    expect(err(() => priceOrder({ lines, promotion: promo({ endsAt: '2000-01-01T00:00:00Z' }) }, S))).toBe('PROMOTION_INACTIVE');
    expect(err(() => priceOrder({ lines, manualDiscount: 1000 }, S))).toBe('DISCOUNT_EXCEEDS');
    expect(err(() => priceOrder({ lines, manualDiscount: 1.005 }, S))).toBe('DISCOUNT_INVALID');
    expect(err(() => priceOrder({ lines, redeemPoints: 10 }, S))).toBe('POINTS_NO_CUSTOMER');
    expect(err(() => priceOrder({ lines, redeemPoints: 5, customer: { pointsBalance: 50 } }, S))).toBe('POINTS_BELOW_MIN');
    expect(err(() => priceOrder({ lines, redeemPoints: 60, customer: { pointsBalance: 50 } }, S))).toBe('POINTS_INSUFFICIENT');
  });
  it('fixed promotion never exceeds the amount due', () => {
    expect(priceOrder({ lines: [{ productId: 'a', unitPrice: 10, quantity: 1 }], promotion: promo({ discountType: 'FIXED', value: 50 }) }, S).total).toBe(0);
  });
});

describe('payments', () => {
  it('validates mixed payments and computes change', () => {
    expect(checkPayments(317, [{ method: 'QR', amount: 200 }, { method: 'CASH', amount: 117, tendered: 150 }]))
      .toMatchObject({ valid: true, change: 33, remaining: 0 });
    expect(checkPayments(317, [{ method: 'QR', amount: 200 }])).toMatchObject({ valid: false, error: 'UNDERPAID', remaining: 117 });
    expect(checkPayments(100, [{ method: 'CARD', amount: 120 }])).toMatchObject({ valid: false, error: 'OVERPAID' });
    expect(checkPayments(100, [{ method: 'CASH', amount: 100, tendered: 50 }]).error).toBe('TENDER_SHORT');
    expect(checkPayments(100, [{ method: 'CASH', amount: 0 }]).error).toBe('INVALID_AMOUNT');
    expect(checkPayments(0, []).valid).toBe(true);
  });
  it('suggests quick cash and builds cash lines', () => {
    expect(quickCashOptions(317)).toEqual([317, 320, 350, 400, 500]);
    expect(quickCashOptions(1000)).toEqual([1000]);
    expect(cashLine(317, 500)).toEqual({ method: 'CASH', amount: 317, tendered: 500 });
  });
});

describe('promptpay', () => {
  it('builds a valid EMVCo payload', () => {
    expect(crc16('123456789')).toBe('29B1');
    const p = promptPayPayload('081-234-5678', 45);
    expect(p.startsWith('000201010212')).toBe(true);
    expect(p).toContain('01130066812345678');
    expect(p).toContain('540545.00');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
    expect(promptPayPayload('1234567890123')).toContain('02131234567890123');
    expect(isValidPromptPayId('123')).toBe(false);
  });
});

describe('cart', () => {
  it('adds, merges by product+note, edits and clears', () => {
    let s = emptyCart();
    const p = { id: 'a', name: 'คัสตาร์ด', price: 59 };
    s = cartReducer(s, { type: 'add', product: p });
    s = cartReducer(s, { type: 'add', product: p });
    s = cartReducer(s, { type: 'add', product: p, note: 'หวานน้อย' });
    expect(s.lines.map((l) => l.quantity)).toEqual([2, 1]);
    s = cartReducer(s, { type: 'setNote', key: s.lines[1]!.key, note: '' });
    expect(s.lines).toHaveLength(1);
    expect(cartItemCount(s)).toBe(3);
    s = cartReducer(s, { type: 'setQuantity', key: s.lines[0]!.key, quantity: 0 });
    expect(s.lines).toHaveLength(0);
  });
  it('drops redeem points when the customer is removed and reprices from the server menu', () => {
    let s = cartReducer(emptyCart(), { type: 'set', patch: { customer: { id: 'c', name: 'x', phone: null, pointsBalance: 50 }, redeemPoints: 20 } });
    s = cartReducer(s, { type: 'set', patch: { customer: null } });
    expect(s.redeemPoints).toBe(0);
    s = cartReducer(s, { type: 'add', product: { id: 'a', name: 'a', price: 50 } });
    s = cartReducer(s, { type: 'add', product: { id: 'gone', name: 'g', price: 5 } });
    s = cartReducer(s, { type: 'repriced', prices: { a: 55 } });
    expect(s.lines).toEqual([expect.objectContaining({ productId: 'a', unitPrice: 55 })]);
  });
});

/**
 * Order pricing preview — mirrors public.price_order() in the database.
 * The database is authoritative (it re-prices every order); this exists so the POS
 * can show totals instantly, including while offline.
 * test/db/phase5-6-pricing-parity.test.ts asserts both agree.
 */
import { round2 } from './money';

export interface PricingSettings {
  vatEnabled: boolean;
  vatInclusive: boolean;
  vatRate: number;
  bahtPerPoint: number;
  pointValue: number;
  minRedeemPoints: number;
}

export interface PromotionRule {
  id: string;
  name: string;
  discountType: 'PERCENT' | 'FIXED';
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  membersOnly: boolean;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
}

export interface PricingLine { productId: string; unitPrice: number; quantity: number }

export interface PricingInput {
  lines: readonly PricingLine[];
  promotion?: PromotionRule | null;
  customer?: { pointsBalance: number } | null;
  manualDiscount?: number;
  redeemPoints?: number;
  now?: Date;
}

export interface PricingResult {
  subtotal: number;
  promotionDiscount: number;
  manualDiscount: number;
  pointsRedeemed: number;
  pointsDiscount: number;
  vatAmount: number;
  total: number;
  pointsEarned: number;
}

export type PricingErrorCode =
  | 'EMPTY' | 'INVALID_QUANTITY' | 'PROMOTION_INACTIVE' | 'PROMOTION_MEMBERS_ONLY' | 'PROMOTION_MIN_SUBTOTAL'
  | 'DISCOUNT_INVALID' | 'DISCOUNT_EXCEEDS' | 'POINTS_NO_CUSTOMER' | 'POINTS_INSUFFICIENT' | 'POINTS_BELOW_MIN' | 'POINTS_EXCEEDS';

export class PricingError extends Error {
  constructor(public readonly code: PricingErrorCode) {
    super(code);
  }
}

export function promotionError(promo: PromotionRule, subtotal: number, hasCustomer: boolean, now = new Date()): PricingErrorCode | null {
  if (!promo.isActive) return 'PROMOTION_INACTIVE';
  if (promo.startsAt && now < new Date(promo.startsAt)) return 'PROMOTION_INACTIVE';
  if (promo.endsAt && now > new Date(promo.endsAt)) return 'PROMOTION_INACTIVE';
  if (promo.membersOnly && !hasCustomer) return 'PROMOTION_MEMBERS_ONLY';
  if (subtotal < promo.minSubtotal) return 'PROMOTION_MIN_SUBTOTAL';
  return null;
}

export function priceOrder(input: PricingInput, s: PricingSettings): PricingResult {
  if (input.lines.length === 0) throw new PricingError('EMPTY');
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0 || l.quantity > 999) throw new PricingError('INVALID_QUANTITY');
  }
  const subtotal = round2(input.lines.reduce((sum, l) => sum + round2(l.unitPrice * l.quantity), 0));
  let remaining = subtotal;

  let promotionDiscount = 0;
  if (input.promotion) {
    const err = promotionError(input.promotion, subtotal, !!input.customer, input.now);
    if (err) throw new PricingError(err);
    const p = input.promotion;
    promotionDiscount = p.discountType === 'PERCENT' ? round2((subtotal * p.value) / 100) : p.value;
    if (p.maxDiscount !== null) promotionDiscount = Math.min(promotionDiscount, p.maxDiscount);
    promotionDiscount = round2(Math.min(promotionDiscount, remaining));
    remaining = round2(remaining - promotionDiscount);
  }

  const manualDiscount = input.manualDiscount ?? 0;
  if (manualDiscount < 0 || round2(manualDiscount) !== manualDiscount) throw new PricingError('DISCOUNT_INVALID');
  if (manualDiscount > remaining) throw new PricingError('DISCOUNT_EXCEEDS');
  remaining = round2(remaining - manualDiscount);

  const pointsRedeemed = input.redeemPoints ?? 0;
  let pointsDiscount = 0;
  if (pointsRedeemed > 0) {
    if (!input.customer) throw new PricingError('POINTS_NO_CUSTOMER');
    if (pointsRedeemed > input.customer.pointsBalance) throw new PricingError('POINTS_INSUFFICIENT');
    if (pointsRedeemed < s.minRedeemPoints) throw new PricingError('POINTS_BELOW_MIN');
    pointsDiscount = round2(pointsRedeemed * s.pointValue);
    if (pointsDiscount > remaining) throw new PricingError('POINTS_EXCEEDS');
    remaining = round2(remaining - pointsDiscount);
  }

  let vatAmount = 0;
  let total = remaining;
  if (s.vatEnabled && s.vatRate > 0) {
    if (s.vatInclusive) {
      vatAmount = round2((remaining * s.vatRate) / (100 + s.vatRate));
    } else {
      vatAmount = round2((remaining * s.vatRate) / 100);
      total = round2(remaining + vatAmount);
    }
  }
  const pointsEarned = input.customer && s.bahtPerPoint > 0 ? Math.floor(total / s.bahtPerPoint) : 0;
  return { subtotal, promotionDiscount, manualDiscount, pointsRedeemed, pointsDiscount, vatAmount, total, pointsEarned };
}

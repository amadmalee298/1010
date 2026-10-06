/** Payment helpers for the POS (mixed payments, cash change, quick-cash suggestions). */
import { round2, sumBaht, toSatang } from './money';

export type PaymentMethod = 'CASH' | 'QR' | 'TRANSFER' | 'CARD';

export interface PaymentLine {
  method: PaymentMethod;
  amount: number;          // applied to the bill
  tendered?: number;       // CASH: handed over by the customer
  reference?: string;
}

export interface PaymentCheck {
  paid: number;
  remaining: number;       // > 0 still due, 0 settled
  change: number;          // total cash change to give back
  valid: boolean;
  error: 'NONE' | 'UNDERPAID' | 'OVERPAID' | 'TENDER_SHORT' | 'INVALID_AMOUNT';
}

export function checkPayments(total: number, lines: readonly PaymentLine[]): PaymentCheck {
  for (const l of lines) {
    if (!(l.amount > 0) || toSatang(l.amount) !== Math.round(l.amount * 100)) {
      return { paid: 0, remaining: total, change: 0, valid: false, error: 'INVALID_AMOUNT' };
    }
    if (l.method === 'CASH' && l.tendered !== undefined && l.tendered < l.amount) {
      return { paid: 0, remaining: total, change: 0, valid: false, error: 'TENDER_SHORT' };
    }
  }
  const paid = sumBaht(lines.map((l) => l.amount));
  const remaining = round2(total - paid);
  const change = sumBaht(lines.filter((l) => l.method === 'CASH').map((l) => round2((l.tendered ?? l.amount) - l.amount)));
  if (remaining > 0) return { paid, remaining, change, valid: false, error: 'UNDERPAID' };
  if (remaining < 0) return { paid, remaining, change, valid: false, error: 'OVERPAID' };
  return { paid, remaining: 0, change, valid: true, error: 'NONE' };
}

/** Build a single cash line when the customer hands over `tendered` for the amount due. */
export function cashLine(amountDue: number, tendered: number): PaymentLine {
  return { method: 'CASH', amount: round2(amountDue), tendered: round2(Math.max(tendered, amountDue)) };
}

/** Suggested banknote amounts for the cash keypad (exact, then next round-ups). */
export function quickCashOptions(amount: number): number[] {
  if (amount <= 0) return [];
  const out = new Set<number>([round2(amount)]);
  for (const step of [20, 50, 100, 500, 1000]) {
    const v = Math.ceil(amount / step) * step;
    if (v > amount) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

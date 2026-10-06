/**
 * Money helpers. Amounts are THB with 2 decimals. Arithmetic is done in integer
 * satang to avoid floating point drift, then converted back.
 */
export type Baht = number;

export const toSatang = (baht: Baht): number => Math.round(baht * 100);
export const fromSatang = (satang: number): Baht => satang / 100;

/** Round to 2 decimals (half away from zero), matching PostgreSQL round(numeric, 2). */
export function round2(value: number): Baht {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-9)) / 100;
}

/** Round to 4 decimals (costs / quantities), matching PostgreSQL round(numeric, 4). */
export function round4(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 10_000 + 1e-9)) / 10_000;
}

export function sumBaht(values: readonly Baht[]): Baht {
  return fromSatang(values.reduce((acc, v) => acc + toSatang(v), 0));
}

const thb = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2 });
const plain = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatTHB = (value: Baht): string => thb.format(value);
export const formatAmount = (value: Baht): string => plain.format(value);

export function formatQty(value: number, maxFractionDigits = 3): string {
  return new Intl.NumberFormat('th-TH', { maximumFractionDigits: maxFractionDigits }).format(value);
}

export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

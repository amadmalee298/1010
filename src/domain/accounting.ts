import { z } from 'zod';

/** Shapes returned by the statement functions (numbers arrive as JSON numbers or numeric strings). */
const num = z.coerce.number();
const line = z.object({ code: z.string(), name_th: z.string(), name_en: z.string(), type: z.string(), amount: num });

export const balanceSheetSchema = z.object({
  as_of: z.string(), lines: z.array(line), total_assets: num, total_liabilities: num, equity_accounts: num,
  earnings_to_date: num, total_equity: num, difference: num,
});
export const glPnlSchema = z.object({
  from: z.string(), to: z.string(), lines: z.array(line),
  expense_categories: z.array(z.object({ category: z.string(), amount: num })),
  revenue: num, cogs: num, gross_profit: num, other_costs: num, operating_expenses: num, net_profit: num,
});
export const cashFlowSchema = z.object({
  from: z.string(), to: z.string(), opening_cash: num, closing_cash: num, operating: num, investing: num, financing: num,
  items: z.record(z.string(), num),
  closing_by_account: z.array(z.object({ code: z.string(), name_th: z.string(), name_en: z.string(), balance: num })),
});
export type BalanceSheet = z.infer<typeof balanceSheetSchema>;
export type GlPnl = z.infer<typeof glPnlSchema>;
export type CashFlow = z.infer<typeof cashFlowSchema>;

const amount = z.preprocess((v) => (v === '' || v === null || v === undefined ? 0 : v), z.coerce.number().finite().min(0).max(1_000_000_000));
export const journalLineSchema = z.object({
  account_code: z.string().regex(/^\d{4}$/),
  debit: amount,
  credit: amount,
  note: z.string().trim().max(200).optional(),
}).refine((l) => (l.debit > 0) !== (l.credit > 0), { message: 'debit or credit' });

export const journalSchema = z.object({
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().trim().min(1).max(300),
  is_opening: z.boolean().default(false),
  lines: z.array(journalLineSchema).min(2).max(50),
}).refine((j) => Math.round(j.lines.reduce((s, l) => s + l.debit - l.credit, 0) * 100) === 0, { message: 'unbalanced', path: ['lines'] });
export type JournalInput = z.infer<typeof journalSchema>;

/** Data URL of a PNG signature, small enough for documents. */
export const signatureSchema = z.object({
  image: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/).max(200_000).nullable(),
});

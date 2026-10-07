import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import type { AccountLedgerRow, AccountRow, JournalEntryRow, JournalLineRow, TrialBalanceRow } from '@/lib/database.types';
import { balanceSheetSchema, cashFlowSchema, glPnlSchema, type BalanceSheet, type CashFlow, type GlPnl } from '@/domain/accounting';
import { unwrap, unwrapMaybe } from '../db';

export async function balanceSheet(db: SupabaseServerClient, asOf: string): Promise<BalanceSheet> {
  return balanceSheetSchema.parse(unwrap(await db.rpc('report_balance_sheet', { p_as_of: asOf })));
}
export async function glPnl(db: SupabaseServerClient, from: string, to: string): Promise<GlPnl> {
  return glPnlSchema.parse(unwrap(await db.rpc('report_gl_pnl', { p_from: from, p_to: to })));
}
export async function cashFlow(db: SupabaseServerClient, from: string, to: string): Promise<CashFlow> {
  return cashFlowSchema.parse(unwrap(await db.rpc('report_cash_flow', { p_from: from, p_to: to })));
}
export async function trialBalance(db: SupabaseServerClient, asOf: string): Promise<TrialBalanceRow[]> {
  return unwrap(await db.rpc('report_trial_balance', { p_as_of: asOf })).map((r) => ({
    ...r, debit: Number(r.debit), credit: Number(r.credit), balance: Number(r.balance),
  }));
}
export async function accountLedger(db: SupabaseServerClient, account: string, from: string, to: string): Promise<AccountLedgerRow[]> {
  return unwrap(await db.rpc('report_account_ledger', { p_account: account, p_from: from, p_to: to })).map((r) => ({
    ...r, debit: Number(r.debit), credit: Number(r.credit), running_balance: Number(r.running_balance),
  }));
}
export async function listAccounts(db: SupabaseServerClient): Promise<AccountRow[]> {
  return unwrap(await db.from('accounts').select('*').order('sort_order'));
}
export async function listJournals(db: SupabaseServerClient): Promise<(JournalEntryRow & { lines: JournalLineRow[] })[]> {
  const entries = unwrap(await db.from('journal_entries').select('*').order('entry_date', { ascending: false }).order('created_at', { ascending: false }).limit(100));
  if (!entries.length) return [];
  const lines = unwrap(await db.from('journal_lines').select('*').in('entry_id', entries.map((e) => e.id)));
  return entries.map((e) => ({ ...e, lines: lines.filter((l) => l.entry_id === e.id).map((l) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })) }));
}
export async function mySignature(db: SupabaseServerClient, employeeId: string): Promise<string | null> {
  const row = unwrapMaybe<{ image: string }>(await db.from('employee_signatures').select('image').eq('employee_id', employeeId).maybeSingle());
  return row?.image ?? null;
}

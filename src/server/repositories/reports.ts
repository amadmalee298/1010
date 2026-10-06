import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import { dashboardSchema, pnlSchema, salesReportSchema, type Dashboard, type ProfitAndLoss, type SalesReport } from '@/domain/schemas/reports';
import { unwrap } from '../db';

type Range = { from: string; to: string };
const args = (r: Range) => ({ p_from: r.from, p_to: r.to });

export async function dashboard(db: SupabaseServerClient, date?: string): Promise<Dashboard> {
  return dashboardSchema.parse(unwrap(await db.rpc('dashboard', { p_date: date ?? null })));
}
export async function salesReport(db: SupabaseServerClient, r: Range): Promise<SalesReport> {
  return salesReportSchema.parse(unwrap(await db.rpc('report_sales', args(r))));
}
export async function profitAndLoss(db: SupabaseServerClient, r: Range): Promise<ProfitAndLoss> {
  return pnlSchema.parse(unwrap(await db.rpc('report_pnl', args(r))));
}
export const productReport = async (db: SupabaseServerClient, r: Range) => unwrap(await db.rpc('report_products', args(r)));
export const inventoryReport = async (db: SupabaseServerClient, r: Range) => unwrap(await db.rpc('report_inventory', args(r)));
export const purchaseReport = async (db: SupabaseServerClient, r: Range) => unwrap(await db.rpc('report_purchases', args(r)));
export const productionReport = async (db: SupabaseServerClient, r: Range) => unwrap(await db.rpc('report_production', args(r)));
export const expenseReport = async (db: SupabaseServerClient, r: Range) => unwrap(await db.rpc('report_expenses', args(r)));
export const cashReport = async (db: SupabaseServerClient, r: Range) => unwrap(await db.rpc('report_cash', args(r)));
export const employeeReport = async (db: SupabaseServerClient, r: Range) => unwrap(await db.rpc('report_employee_sales', args(r)));

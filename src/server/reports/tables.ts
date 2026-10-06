import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import type { Dictionary } from '@/i18n';
import type { CsvValue } from '@/domain/csv';
import type { ReportType } from '@/domain/schemas/reports';
import { round2 } from '@/domain/money';
import * as r from '../repositories/reports';

export interface ReportTable {
  headers: string[];
  rows: CsvValue[][];
  /** Column indexes that hold numbers (right-aligned, formatted). */
  numeric: number[];
  /** Column indexes holding ratios 0..1 (shown as %). */
  percent?: number[];
}

const pct = (v: number | null) => (v === null ? null : round2(v * 100) / 100);

/** One definition per report: the page and the CSV export both render from this. */
export async function buildReport(db: SupabaseServerClient, type: ReportType, range: { from: string; to: string }, t: Dictionary): Promise<ReportTable> {
  const R = t.reports;
  switch (type) {
    case 'sales': {
      const s = await r.salesReport(db, range);
      return {
        headers: [R.day, R.orders, R.netSales, R.cogs, R.grossProfit],
        rows: s.by_day.map((d) => [d.day, d.orders, d.net_sales, round2(d.cogs), round2(d.net_sales - d.cogs)]),
        numeric: [1, 2, 3, 4],
      };
    }
    case 'products':
    case 'menu':
    case 'cogs': {
      const rows = await r.productReport(db, range);
      if (type === 'cogs') {
        return {
          headers: [t.common.name, R.quantity, R.cogs, t.catalog.unitCost],
          rows: rows.map((x) => [x.product_name, x.quantity, x.cogs, x.quantity ? round2(x.cogs / x.quantity) : null]),
          numeric: [1, 2, 3],
        };
      }
      return {
        headers: [t.common.name, R.category, R.quantity, R.netSales, R.cogs, R.grossProfit, R.grossMargin, R.share],
        rows: (type === 'menu' ? [...rows].sort((a, b) => (b.gross_profit ?? 0) - (a.gross_profit ?? 0)) : rows)
          .map((x) => [x.product_name, x.category_name, x.quantity, x.net_sales, x.cogs, x.gross_profit, pct(x.gross_margin), pct(x.share_of_sales)]),
        numeric: [2, 3, 4, 5, 6, 7], percent: [6, 7],
      };
    }
    case 'inventory': {
      const rows = await r.inventoryReport(db, range);
      return {
        headers: [t.common.name, t.common.unit, R.purchased, R.produced, R.sold, R.consumed, R.wasted, R.adjusted, R.returned, t.catalog.stock, R.stockValue],
        rows: rows.map((x) => [x.name_th, x.unit, x.purchased, x.produced, x.sold, x.consumed_in_production, x.wasted, x.adjusted, x.returned, x.stock_qty, x.stock_value]),
        numeric: [2, 3, 4, 5, 6, 7, 8, 9, 10],
      };
    }
    case 'purchases': {
      const rows = await r.purchaseReport(db, range);
      return { headers: [R.supplier, R.orders, R.receivedValue], rows: rows.map((x) => [x.supplier_name, x.orders, x.received_value]), numeric: [1, 2] };
    }
    case 'production': {
      const rows = await r.productionReport(db, range);
      return {
        headers: [t.common.name, R.runs, t.production.planned, t.production.actual, t.production.totalCost, t.production.unitCost, R.yieldRate],
        rows: rows.map((x) => [x.product_name, x.runs, x.planned_output, x.actual_output, x.total_cost, x.avg_unit_cost, pct(x.yield_rate)]),
        numeric: [1, 2, 3, 4, 5, 6], percent: [6],
      };
    }
    case 'expenses': {
      const rows = await r.expenseReport(db, range);
      return { headers: [R.category, R.entries, R.amount], rows: rows.map((x) => [x.category, x.entries, x.amount]), numeric: [1, 2] };
    }
    case 'cash': {
      const rows = await r.cashReport(db, range);
      return {
        headers: [R.day, t.cash.openedBy, t.cash.openingCash, t.cash.cashSales, t.cash.refunds, t.cash.expenses, t.cash.withdrawals, t.cash.deposits, t.cash.expected, t.cash.actual, t.cash.variance],
        rows: rows.map((x) => [x.opened_at.slice(0, 16).replace('T', ' '), x.opened_by_name, x.opening_cash, x.cash_sales, x.cash_refunds, x.cash_expenses, x.withdrawals, x.deposits, x.expected_cash, x.actual_cash, x.variance]),
        numeric: [2, 3, 4, 5, 6, 7, 8, 9, 10],
      };
    }
    case 'employees': {
      const rows = await r.employeeReport(db, range);
      return {
        headers: [R.employee, R.orders, R.netSales, R.avgTicket, R.refunds],
        rows: rows.map((x) => [x.employee_name, x.orders, x.net_sales, x.avg_ticket, x.refunds]),
        numeric: [1, 2, 3, 4],
      };
    }
    case 'pnl': {
      const p = await r.profitAndLoss(db, range);
      const rows: CsvValue[][] = [
        [R.grossSales, p.gross_sales], [R.discounts, -p.discounts], [R.refunds, -p.refunds], [R.vat, -p.vat],
        [R.netSales, p.net_sales], [R.cogs, -p.cogs], [R.grossProfit, p.gross_profit], [R.waste, -p.waste], [R.shrinkage, -p.shrinkage],
        ...p.expenses.map((e): CsvValue[] => [`${R.expenses}: ${e.category}`, -e.amount]),
        [R.netProfit, p.net_profit],
      ];
      return { headers: ['', R.amount], rows, numeric: [1] };
    }
  }
}

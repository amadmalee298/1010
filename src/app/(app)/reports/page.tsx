import Link from 'next/link';
import { Download } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { buildReport } from '@/server/reports/tables';
import { salesReport } from '@/server/repositories/reports';
import { getT } from '@/i18n/server';
import { PageHeader, StatCard } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ColumnChart } from '@/components/reports/charts';
import { ReportTableView } from '@/components/reports/report-table';
import { REPORT_TYPES, reportRangeSchema, type ReportType } from '@/domain/schemas/reports';
import { MANAGEMENT } from '@/domain/permissions';
import { addDays, bangkokDate } from '@/domain/datetime';
import { formatAmount, formatTHB } from '@/domain/money';
import { cn } from '@/lib/utils';
import { DbOperationError } from '@/server/action';
import { translateDbError } from '@/server/errors';

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ type?: string; from?: string; to?: string }> }) {
  await requireEmployee(MANAGEMENT);
  const sp = await searchParams;
  const type: ReportType = (REPORT_TYPES as readonly string[]).includes(sp.type ?? '') ? (sp.type as ReportType) : 'sales';
  const today = bangkokDate();
  const parsed = reportRangeSchema.safeParse({ from: sp.from ?? addDays(today, -6), to: sp.to ?? today });
  const range = parsed.success ? parsed.data : { from: addDays(today, -6), to: today };
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const R = t.reports;
  const qs = (patch: Record<string, string>) => new URLSearchParams({ type, ...range, ...patch }).toString();

  let error: string | null = null;
  let table: Awaited<ReturnType<typeof buildReport>> | null = null;
  let sales: Awaited<ReturnType<typeof salesReport>> | null = null;
  try {
    [table, sales] = await Promise.all([buildReport(db, type, range, t), type === 'sales' ? salesReport(db, range) : Promise.resolve(null)]);
  } catch (err) {
    if (err instanceof DbOperationError) error = translateDbError(err.db, t); else throw err;
  }

  return (
    <div className="grid gap-5 p-4 lg:p-6">
      <PageHeader title={R.title} description={R.definitions}
        actions={<Button asChild variant="outline"><a href={`/api/reports/${type}?${new URLSearchParams(range)}`}><Download /> {R.exportCsv}</a></Button>} />
      <nav className="flex flex-wrap gap-2" aria-label={R.title}>
        {REPORT_TYPES.map((rt) => (
          <Link key={rt} href={`/reports?${qs({ type: rt })}`}
            className={cn('rounded-full border px-4 py-2 text-sm font-medium', rt === type ? 'border-foreground bg-foreground text-background' : 'border-border bg-card hover:bg-muted')}>
            {R.types[rt]}
          </Link>
        ))}
      </nav>
      <form className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="type" value={type} />
        <Input type="date" name="from" defaultValue={range.from} className="w-auto" aria-label={t.common.from} />
        <Input type="date" name="to" defaultValue={range.to} className="w-auto" aria-label={t.common.to} />
        <Button type="submit" variant="outline">{t.common.search}</Button>
        <Link className="text-sm text-primary-strong underline-offset-4 hover:underline" href={`/reports?${qs({ from: today, to: today })}`}>{t.common.today}</Link>
        <Link className="text-sm text-primary-strong underline-offset-4 hover:underline" href={`/reports?${qs({ from: addDays(today, -29), to: today })}`}>{t.common.last30}</Link>
      </form>
      {error ? <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {sales ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label={R.netSales} value={formatTHB(sales.summary.net_sales)} />
            <StatCard label={R.orders} value={sales.summary.orders} />
            <StatCard label={R.avgTicket} value={formatAmount(sales.summary.avg_ticket)} />
            <StatCard label={R.discounts} value={formatAmount(sales.summary.discounts)} />
            <StatCard label={R.refunds} value={formatAmount(sales.summary.refunds)} />
            <StatCard label={R.grossProfit} value={formatAmount(sales.summary.net_sales - sales.summary.cogs)} />
          </div>
          <Card>
            <CardHeader><CardTitle>{R.netSales}</CardTitle></CardHeader>
            <CardContent><ColumnChart title={R.netSales} data={sales.by_day.map((d) => ({ label: d.day.slice(5).replace('-', '/'), value: d.net_sales }))} /></CardContent>
          </Card>
        </>
      ) : null}
      {table ? (
        <section aria-label={R.tableView}>
          <ReportTableView headers={table.headers} rows={table.rows} numeric={table.numeric} percent={table.percent} emptyText={t.common.noData} />
        </section>
      ) : null}
    </div>
  );
}

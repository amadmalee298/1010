import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { dashboard } from '@/server/repositories/reports';
import { getT } from '@/i18n/server';
import { PageHeader, StatCard } from '@/components/ui/misc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ColumnChart, RankedBars } from '@/components/reports/charts';
import { MANAGEMENT } from '@/domain/permissions';
import { formatAmount, formatPercent, formatQty, formatTHB } from '@/domain/money';
import { formatDate } from '@/domain/datetime';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requireEmployee(MANAGEMENT);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const d = await dashboard(db);
  const p = d.pnl;
  const R = t.reports;
  return (
    <div className="grid gap-5 p-4 lg:p-6">
      <PageHeader title={R.dashboard} description={`${formatDate(d.date)} · ${R.definitions}`}
        actions={!d.open_session ? <Badge variant="warning">{R.noSession}</Badge> : undefined} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label={R.todaySales} value={formatTHB(p.net_sales)} className="col-span-2" />
        <StatCard label={R.todayOrders} value={d.orders} hint={`${R.avgTicket} ฿${formatAmount(d.avg_ticket)}`} />
        <StatCard label={R.cogs} value={formatAmount(p.cogs)} />
        <StatCard label={R.grossProfit} value={formatAmount(p.gross_profit)} hint={p.gross_margin === null ? undefined : `${R.grossMargin} ${formatPercent(p.gross_margin)}`} />
        <StatCard label={R.expenses} value={formatAmount(p.expenses_total)} />
        <StatCard label={R.waste} value={formatAmount(p.waste + p.shrinkage)} tone={p.waste > 0 ? 'warning' : 'default'} />
        <StatCard label={R.netProfit} value={formatAmount(p.net_profit)} tone={p.net_profit >= 0 ? 'success' : 'destructive'} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>{R.salesTrend}</CardTitle></CardHeader>
          <CardContent><ColumnChart title={R.salesTrend} data={d.trend.map((x) => ({ label: x.day.slice(5).replace('-', '/'), value: x.net_sales }))} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{R.paymentBreakdown}</CardTitle></CardHeader>
          <CardContent>
            {d.by_payment.length
              ? <RankedBars title={R.paymentBreakdown} data={d.by_payment.map((x) => ({ label: t.pos.method[x.method], value: x.amount }))} />
              : <p className="text-sm text-muted-foreground">{t.common.noData}</p>}
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>{R.salesByHour}</CardTitle></CardHeader>
          <CardContent>
            <ColumnChart title={R.salesByHour} height={200}
              data={Array.from({ length: 16 }, (_, i) => i + 7).map((h) => ({ label: `${h}:00`, value: d.by_hour.find((x) => x.hour === h)?.net_sales ?? 0 }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{R.topProducts}</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {d.top_products.length === 0 ? <p className="text-sm text-muted-foreground">{t.common.noData}</p> : null}
            {d.top_products.map((x, i) => (
              <div key={x.product_name} className="flex items-center justify-between gap-2 text-sm">
                <span>{i + 1}. {x.product_name} <span className="text-muted-foreground">× {formatQty(x.quantity)}</span></span>
                <span className="tabular-nums">฿{formatAmount(x.net_sales)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>{R.lowStock}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {d.low_stock.length === 0 ? <p className="text-sm text-muted-foreground">✓</p> : null}
          {d.low_stock.map((x) => (
            <Link key={x.id} href="/inventory"><Badge variant="destructive">{x.name_th}: {formatQty(x.stock_qty)} / {formatQty(x.reorder_level)} {x.unit}</Badge></Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

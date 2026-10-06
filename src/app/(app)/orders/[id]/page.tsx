import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { getOrder } from '@/server/repositories/orders';
import { getSettings } from '@/server/repositories/settings';
import { getT } from '@/i18n/server';
import { PageHeader, StatCard } from '@/components/ui/misc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { OrderActions } from '@/components/orders/order-actions';
import { can, FRONT_OF_HOUSE } from '@/domain/permissions';
import { formatAmount, formatPercent } from '@/domain/money';
import { formatDateTime } from '@/domain/datetime';

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await requireEmployee(FRONT_OF_HOUSE);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const [order, settings] = await Promise.all([getOrder(db, id), getSettings(db)]);
  if (!order) notFound();
  const manager = can(employee.role, 'refund');
  const net = order.total - order.refunded_total;
  return (
    <div className="p-4 lg:p-6">
      <PageHeader
        title={`${t.pos.queue} ${order.queue_number} · ${order.order_number}`}
        description={`${formatDateTime(order.created_at)} · ${order.cashier_name ?? ''} · ${t.pos.orderType[order.order_type]}`}
        actions={<OrderActions order={order} canManage={manager} settings={{
          shopName: settings.shop_name, shopAddress: settings.shop_address, shopPhone: settings.shop_phone, taxId: settings.tax_id,
          vatEnabled: settings.vat_enabled, vatRate: settings.vat_rate, receiptFooter: settings.receipt_footer,
        }} />}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge>{t.orders.status[order.status]}</Badge>
        {order.cancel_reason ? <Badge variant="destructive">{order.cancel_reason}</Badge> : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Table>
          <THead><TR><TH>{t.common.name}</TH><TH className="text-right">{t.common.quantity}</TH><TH className="text-right">{t.common.price}</TH><TH className="text-right">{t.common.total}</TH>{manager ? <TH className="text-right">{t.orders.cogs}</TH> : null}</TR></THead>
          <TBody>
            {order.items.map((i) => (
              <TR key={i.id}>
                <TD>{i.product_name}{i.note ? <p className="text-xs text-muted-foreground">📝 {i.note}</p> : null}{i.refunded_quantity ? <Badge variant="warning" className="ml-1">-{i.refunded_quantity}</Badge> : null}</TD>
                <TD className="text-right">{i.quantity}</TD>
                <TD className="text-right tabular-nums">{formatAmount(i.unit_price)}</TD>
                <TD className="text-right tabular-nums">{formatAmount(i.line_total)}</TD>
                {manager ? <TD className="text-right tabular-nums">{formatAmount(i.cogs_total)}</TD> : null}
              </TR>
            ))}
          </TBody>
        </Table>
        <div className="grid content-start gap-3">
          <Card>
            <CardHeader><CardTitle>{t.pos.payment}</CardTitle></CardHeader>
            <CardContent className="grid gap-1 text-sm">
              <div className="flex justify-between"><span>{t.pos.subtotal}</span><span>{formatAmount(order.subtotal)}</span></div>
              {order.promotion_discount ? <div className="flex justify-between"><span>{t.pos.promotion}</span><span>-{formatAmount(order.promotion_discount)}</span></div> : null}
              {order.manual_discount ? <div className="flex justify-between"><span>{t.pos.discounts}</span><span>-{formatAmount(order.manual_discount)}</span></div> : null}
              {order.points_discount ? <div className="flex justify-between"><span>{t.pos.redeemPoints}</span><span>-{formatAmount(order.points_discount)}</span></div> : null}
              {order.vat_amount ? <div className="flex justify-between text-muted-foreground"><span>{t.pos.vat}</span><span>{formatAmount(order.vat_amount)}</span></div> : null}
              <div className="flex justify-between text-base font-semibold"><span>{t.pos.total}</span><span>{formatAmount(order.total)}</span></div>
              {order.payments.map((p, i) => (
                <div key={i} className="flex justify-between text-muted-foreground"><span>{t.pos.method[p.method]}{p.reference ? ` (${p.reference})` : ''}</span><span>{formatAmount(p.amount)}</span></div>
              ))}
              {order.refunded_total ? <div className="flex justify-between text-destructive"><span>{t.orders.refund}</span><span>-{formatAmount(order.refunded_total)}</span></div> : null}
            </CardContent>
          </Card>
          {manager ? (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label={t.orders.cogs} value={formatAmount(order.cogs_total)} />
              <StatCard label={t.orders.grossProfit} value={formatAmount(net - order.vat_amount - order.cogs_total)}
                hint={net > 0 ? formatPercent((net - order.vat_amount - order.cogs_total) / (net - order.vat_amount || 1)) : undefined} />
            </div>
          ) : null}
          {order.customer ? <Card><CardContent className="pt-5 text-sm">⭐ {order.customer.name} · {order.customer.phone} · +{order.points_earned} {t.pos.points}</CardContent></Card> : null}
          {order.refunds.length ? (
            <Card>
              <CardHeader><CardTitle>{t.orders.refunds}</CardTitle></CardHeader>
              <CardContent className="grid gap-1 text-sm">
                {order.refunds.map((r) => <div key={r.refund_number} className="flex justify-between"><span>{r.refund_number} · {r.reason}</span><span>{formatAmount(r.amount)}</span></div>)}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

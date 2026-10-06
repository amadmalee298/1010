import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listOrders } from '@/server/repositories/orders';
import { getT } from '@/i18n/server';
import { PageHeader, StatCard } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input, NativeSelect } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { bangkokDate, formatTime } from '@/domain/datetime';
import { formatAmount, formatTHB } from '@/domain/money';
import { FRONT_OF_HOUSE } from '@/domain/permissions';
import type { OrderStatus } from '@/lib/database.types';

const STATUSES: OrderStatus[] = ['COMPLETED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
const badge = { COMPLETED: 'success', CANCELLED: 'destructive', PARTIALLY_REFUNDED: 'warning', REFUNDED: 'secondary' } as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ date?: string; status?: string; q?: string }> }) {
  await requireEmployee(FRONT_OF_HOUSE);
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : bangkokDate();
  const status = STATUSES.find((s) => s === sp.status);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const orders = await listOrders(db, { date, status, search: sp.q?.slice(0, 30) });
  const valid = orders.filter((o) => o.status !== 'CANCELLED');
  const net = valid.reduce((s, o) => s + o.total - o.refunded_total, 0);

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.orders.title} />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input type="date" name="date" defaultValue={date} className="w-auto" />
        <NativeSelect name="status" defaultValue={status ?? ''} className="w-auto">
          <option value="">{t.common.all}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t.orders.status[s]}</option>)}
        </NativeSelect>
        <Input name="q" placeholder={t.orders.number} defaultValue={sp.q ?? ''} className="w-40" />
        <Button type="submit" variant="outline">{t.common.search}</Button>
      </form>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label={t.orders.title} value={valid.length} />
        <StatCard label={t.pos.total} value={formatTHB(net)} />
        <StatCard label={t.orders.status.CANCELLED} value={orders.length - valid.length} />
      </div>
      <Table>
        <THead><TR><TH>{t.pos.queue}</TH><TH>{t.orders.number}</TH><TH>{t.orders.time}</TH><TH>{t.common.type}</TH><TH>{t.common.status}</TH><TH className="text-right">{t.pos.total}</TH></TR></THead>
        <TBody>
          {orders.map((o) => (
            <TR key={o.id} className="hover:bg-muted/50">
              <TD className="text-lg font-semibold">{o.queue_number}</TD>
              <TD><Link href={`/orders/${o.id}`} className="font-medium text-primary-strong hover:underline">{o.order_number}</Link></TD>
              <TD>{formatTime(o.created_at)}</TD>
              <TD>{t.pos.orderType[o.order_type]}{o.table_label ? ` · ${o.table_label}` : ''}</TD>
              <TD><Badge variant={badge[o.status]}>{t.orders.status[o.status]}</Badge></TD>
              <TD className="text-right tabular-nums">{formatAmount(o.total)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

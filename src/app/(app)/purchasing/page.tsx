import Link from 'next/link';
import { Plus } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listPurchaseOrders, listSuppliers } from '@/server/repositories/operations';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { MANAGEMENT } from '@/domain/permissions';
import { formatAmount } from '@/domain/money';
import { formatDate } from '@/domain/datetime';

const tone = { DRAFT: 'secondary', ORDERED: 'warning', RECEIVED: 'success', CANCELLED: 'destructive' } as const;

export default async function PurchasingPage() {
  await requireEmployee(MANAGEMENT);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const [orders, suppliers] = await Promise.all([listPurchaseOrders(db), listSuppliers(db)]);
  const name = new Map(suppliers.map((s) => [s.id, s.name]));
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.purchasing.orders} actions={<Button asChild><Link href="/purchasing/new"><Plus /> {t.purchasing.newPo}</Link></Button>} />
      <Table>
        <THead><TR><TH>{t.orders.number}</TH><TH>{t.purchasing.supplier}</TH><TH>{t.common.date}</TH><TH>{t.purchasing.expectedDate}</TH><TH>{t.common.status}</TH><TH className="text-right">{t.purchasing.subtotal}</TH></TR></THead>
        <TBody>
          {orders.map((o) => (
            <TR key={o.id}>
              <TD><Link href={`/purchasing/${o.id}`} className="font-medium text-primary-strong hover:underline">{o.po_number}</Link></TD>
              <TD>{name.get(o.supplier_id)}</TD>
              <TD>{formatDate(o.order_date)}</TD>
              <TD>{o.expected_date ? formatDate(o.expected_date) : '—'}</TD>
              <TD><Badge variant={tone[o.status]}>{t.purchasing.status[o.status]}</Badge></TD>
              <TD className="text-right tabular-nums">{formatAmount(o.subtotal)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

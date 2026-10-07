import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listBills } from '@/server/repositories/bills';
import { getT } from '@/i18n/server';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { MANAGEMENT } from '@/domain/permissions';
import { formatAmount } from '@/domain/money';
import { formatDate, formatDateTime } from '@/domain/datetime';
import { cn } from '@/lib/utils';
import type { BillStatus } from '@/lib/database.types';

const STATUSES: BillStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

export default async function BillsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireEmployee(MANAGEMENT);
  const sp = await searchParams;
  const status: BillStatus = STATUSES.includes(sp.status as BillStatus) ? (sp.status as BillStatus) : 'PENDING';
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const bills = await listBills(db, status);
  const label: Record<BillStatus, string> = { PENDING: t.bills.pending, APPROVED: t.bills.approved, REJECTED: t.bills.rejected };
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.bills.title} description={t.telegram.howTo} />
      <nav className="mb-4 flex gap-2">
        {STATUSES.map((s) => (
          <Link key={s} href={`/bills?status=${s}`}
            className={cn('rounded-full border px-4 py-2 text-sm', s === status ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card')}>
            {label[s]}
          </Link>
        ))}
      </nav>
      {bills.length === 0 ? <EmptyState icon={<Inbox className="size-8" />} title={t.bills.empty} /> : (
        <Table>
          <THead><TR><TH>{t.bills.number}</TH><TH>{t.common.date}</TH><TH>{t.bills.submittedBy}</TH><TH>{t.bills.vendor}</TH><TH /><TH className="text-right">{t.bills.total}</TH></TR></THead>
          <TBody>
            {bills.map((b) => (
              <TR key={b.id}>
                <TD><Link href={`/bills/${b.id}`} className="font-medium text-primary-strong underline-offset-2 hover:underline">{b.submission_number}</Link></TD>
                <TD className="whitespace-nowrap">{b.bill_date ? formatDate(b.bill_date) : formatDateTime(b.created_at)}</TD>
                <TD>{b.submitter_name}</TD>
                <TD>{b.vendor ?? b.message_text ?? '—'}</TD>
                <TD>
                  {b.has_receipt ? <Badge variant="info">{t.bills.hasReceipt}</Badge> : <Badge variant="warning">{t.bills.noReceipt}</Badge>}
                  {b.extraction_error ? <Badge variant="destructive" className="ml-1">{t.bills.aiFailed}</Badge> : null}
                </TD>
                <TD className="text-right tabular-nums">{b.total !== null ? formatAmount(b.total) : '—'}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

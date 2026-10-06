import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { currentSession, listSessions, sessionTransactions } from '@/server/repositories/operations';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CashDrawer } from '@/components/operations/cash-drawer';
import { FRONT_OF_HOUSE } from '@/domain/permissions';
import { formatAmount } from '@/domain/money';
import { formatDateTime, formatTime } from '@/domain/datetime';

export default async function CashPage() {
  await requireEmployee(FRONT_OF_HOUSE);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const [session, history] = await Promise.all([currentSession(db), listSessions(db)]);
  const moves = session ? await sessionTransactions(db, session.id) : [];
  return (
    <div className="grid gap-6 p-4 lg:p-6">
      <PageHeader title={t.cash.title} />
      <CashDrawer session={session} />
      {session ? (
        <section>
          <h2 className="mb-3 font-semibold">{t.cash.movements}</h2>
          <Table>
            <THead><TR><TH>{t.orders.time}</TH><TH>{t.common.type}</TH><TH>{t.common.note}</TH><TH className="text-right">฿</TH></TR></THead>
            <TBody>
              {moves.map((m) => (
                <TR key={m.id}>
                  <TD>{formatTime(m.created_at)}</TD>
                  <TD><Badge variant={m.amount >= 0 ? 'success' : 'warning'}>{t.cash.txn[m.transaction_type]}</Badge></TD>
                  <TD className="text-sm text-muted-foreground">{m.note ?? m.reference_type}</TD>
                  <TD className={`text-right tabular-nums ${m.amount < 0 ? 'text-destructive' : ''}`}>{formatAmount(m.amount)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      ) : null}
      <section>
        <h2 className="mb-3 font-semibold">{t.cash.history}</h2>
        <Table>
          <THead><TR><TH>{t.common.date}</TH><TH>{t.cash.openedBy}</TH><TH>{t.cash.closedBy}</TH><TH className="text-right">{t.cash.totalSales}</TH><TH className="text-right">{t.cash.expected}</TH><TH className="text-right">{t.cash.actual}</TH><TH className="text-right">{t.cash.variance}</TH></TR></THead>
          <TBody>
            {history.map((s) => (
              <TR key={s.id}>
                <TD className="whitespace-nowrap text-sm">{formatDateTime(s.opened_at)}{s.closed_at ? ` – ${formatTime(s.closed_at)}` : ''}</TD>
                <TD>{s.opened_by_name}</TD>
                <TD>{s.status === 'OPEN' ? <Badge variant="success">{t.common.active}</Badge> : s.closed_by_name}</TD>
                <TD className="text-right tabular-nums">{formatAmount(s.total_sales)}</TD>
                <TD className="text-right tabular-nums">{formatAmount(s.expected_cash)}</TD>
                <TD className="text-right tabular-nums">{s.actual_cash === null ? '—' : formatAmount(s.actual_cash)}</TD>
                <TD className="text-right">
                  {s.variance === null ? '—' : <Badge variant={Math.abs(s.variance) < 0.005 ? 'success' : 'destructive'}>{s.variance > 0 ? '+' : ''}{formatAmount(s.variance)}</Badge>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </section>
    </div>
  );
}

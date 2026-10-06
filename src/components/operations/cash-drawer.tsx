'use client';
import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { StatCard } from '@/components/ui/misc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { cashMovementAction, closeSessionAction, openSessionAction } from '@/server/actions/operations';
import { countDenominations, DENOMINATIONS } from '@/domain/schemas/operations';
import { formatAmount, formatTHB } from '@/domain/money';
import type { CashSessionSummaryRow } from '@/lib/database.types';

export function CashDrawer({ session }: { session: CashSessionSummaryRow | null }) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<'DEPOSIT' | 'WITHDRAWAL' | 'close' | null>(null);
  const [counts, setCounts] = useState<Partial<Record<(typeof DENOMINATIONS)[number], number>>>({});
  const open = useAction(openSessionAction);
  const move = useAction(cashMovementAction);
  const close = useAction(closeSessionAction);
  const counted = countDenominations(counts);

  if (!session) {
    return (
      <Card className="max-w-md">
        <CardHeader><CardTitle>{t.cash.noSession}</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); await open.run({ opening_cash: fd.get('opening_cash'), note: fd.get('note') }); }}>
            <Field label={`${t.cash.openingCash} (฿)`}><Input name="opening_cash" type="number" inputMode="decimal" min={0} step="0.01" defaultValue={1000} required /></Field>
            <Field label={t.common.note}><Input name="note" /></Field>
            <Button type="submit" size="lg" disabled={open.pending}><Unlock /> {t.cash.open}</Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  const variance = counted - session.expected_cash;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setDialog('DEPOSIT')}><ArrowDownToLine /> {t.cash.deposit}</Button>
        <Button variant="outline" onClick={() => setDialog('WITHDRAWAL')}><ArrowUpFromLine /> {t.cash.withdrawal}</Button>
        <Button variant="destructive" className="ml-auto" onClick={() => setDialog('close')}><Lock /> {t.cash.close}</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label={t.cash.openingCash} value={formatAmount(session.opening_cash)} />
        <StatCard label={t.cash.cashSales} value={formatAmount(session.cash_sales)} tone="success" />
        <StatCard label={t.cash.refunds} value={formatAmount(session.cash_refunds)} />
        <StatCard label={t.cash.expenses} value={formatAmount(session.cash_expenses)} />
        <StatCard label={`${t.cash.deposits} / ${t.cash.withdrawals}`} value={`+${formatAmount(session.deposits)} / -${formatAmount(session.withdrawals)}`} />
        <StatCard label={t.cash.expected} value={formatTHB(session.expected_cash)} className="border-primary" />
      </div>
      <p className="text-sm text-muted-foreground">{t.cash.totalSales}: {formatTHB(session.total_sales)} · {session.order_count} {t.cash.orders} · {t.cash.openedBy} {session.opened_by_name}</p>

      <Dialog open={dialog === 'DEPOSIT' || dialog === 'WITHDRAWAL'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog === 'DEPOSIT' ? t.cash.deposit : t.cash.withdrawal}</DialogTitle></DialogHeader>
          <form className="grid gap-4" onSubmit={async (e) => {
            e.preventDefault(); const fd = new FormData(e.currentTarget);
            if (await move.run({ type: dialog, amount: fd.get('amount'), note: fd.get('note') })) setDialog(null);
          }}>
            <Field label="฿"><Input name="amount" type="number" inputMode="decimal" min={0.01} step="0.01" required autoFocus /></Field>
            <Field label={t.common.reason}><Input name="note" required /></Field>
            <DialogFooter><Button type="submit" disabled={move.pending}>{t.common.save}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'close'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t.cash.closeTitle}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t.cash.denominations}</p>
          <div className="grid grid-cols-3 gap-2">
            {DENOMINATIONS.map((d) => (
              <Field key={d} label={`฿${d}`}>
                <Input type="number" inputMode="numeric" min={0} step={1} value={counts[d] ?? ''} placeholder="0"
                  onChange={(e) => setCounts((c) => ({ ...c, [d]: Number(e.target.value) || 0 }))} />
              </Field>
            ))}
          </div>
          <div className="grid gap-1 rounded-xl bg-muted p-3 text-sm">
            <div className="flex justify-between"><span>{t.cash.expected}</span><span className="tabular-nums">{formatAmount(session.expected_cash)}</span></div>
            <div className="flex justify-between"><span>{t.cash.actual}</span><span className="tabular-nums">{formatAmount(counted)}</span></div>
            <div className={`flex justify-between text-base font-semibold ${Math.abs(variance) < 0.005 ? 'text-success-strong' : 'text-destructive'}`}>
              <span>{t.cash.variance}</span><span className="tabular-nums">{variance > 0 ? '+' : ''}{formatAmount(variance)}</span>
            </div>
          </div>
          <form className="grid gap-3" onSubmit={async (e) => {
            e.preventDefault(); const fd = new FormData(e.currentTarget);
            if (await close.run({ actual_cash: counted, note: fd.get('note') })) { setDialog(null); setCounts({}); }
          }}>
            <Field label={t.common.note}><Input name="note" /></Field>
            <DialogFooter><Button type="submit" variant="destructive" disabled={close.pending}>{t.cash.close}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

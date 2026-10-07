'use client';
import { useState } from 'react';
import { Plus, Printer, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { postJournalAction, reverseJournalAction } from '@/server/actions/accounting';
import { formatAmount } from '@/domain/money';
import { bangkokDate } from '@/domain/datetime';
import type { AccountRow } from '@/lib/database.types';

interface Line { account_code: string; debit: number | ''; credit: number | ''; note: string }
const blank = (code = ''): Line => ({ account_code: code, debit: '', credit: '', note: '' });
const num = (v: number | '') => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Opening balances: the owner fills the asset/liability amounts; the difference goes to capital. */
const OPENING_TEMPLATE: Line[] = [blank('1010'), blank('1001'), blank('1500'), blank('2100'), blank('3000')];

export function JournalForm({ accounts }: { accounts: AccountRow[] }) {
  const { t, locale } = useI18n();
  const A = t.accounting;
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [opening, setOpening] = useState(false);
  const post = useAction(postJournalAction);
  const usable = accounts.filter((a) => a.code !== '1190');
  const dr = lines.reduce((s, l) => s + num(l.debit), 0);
  const cr = lines.reduce((s, l) => s + num(l.credit), 0);
  const balanced = Math.round(dr * 100) === Math.round(cr * 100) && dr > 0;
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{A.newJournal}</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={() => { setOpening(true); setLines(OPENING_TEMPLATE); }}>{A.openingBalances}</Button>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-muted-foreground">{A.journalHint}</p>
        <div className="mb-4 rounded-xl border border-border bg-muted/50 p-3 text-sm">
          <p className="font-semibold">💡 {A.drCrTitle}</p>
          <ul className="mt-1 grid list-disc gap-1 pl-5">
            <li>{A.drCrDebit}</li>
            <li>{A.drCrCredit}</li>
          </ul>
          <p className="mt-2 font-semibold">⚡ {A.drCrShortTitle}</p>
          <ul className="mt-1 grid list-disc gap-1 pl-5">
            <li>“{A.drCrShortDebit}”</li>
            <li>“{A.drCrShortCredit}”</li>
          </ul>
          <p className="mt-2 text-muted-foreground">{A.drCrBalance}</p>
        </div>
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const ok = await post.run({
            entry_date: fd.get('entry_date'), memo: fd.get('memo'), is_opening: opening,
            lines: lines.filter((l) => l.account_code && (num(l.debit) > 0 || num(l.credit) > 0))
              .map((l) => ({ account_code: l.account_code, debit: num(l.debit), credit: num(l.credit), note: l.note || undefined })),
          });
          if (ok) { setLines([blank(), blank()]); setOpening(false); (e.target as HTMLFormElement).reset(); }
        }}>
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <Field label={t.common.date}><Input type="date" name="entry_date" defaultValue={bangkokDate()} required /></Field>
            <Field label={A.memo}><Input name="memo" required defaultValue={opening ? 'ยอดยกมา' : ''} key={String(opening)} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={opening} onChange={(e) => setOpening(e.target.checked)} /> {A.isOpening}</label>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-border p-2 sm:grid-cols-[1fr_120px_120px_auto]">
              <NativeSelect value={l.account_code} onChange={(e) => set(i, { account_code: e.target.value })} aria-label={A.account} className="col-span-2 sm:col-span-1">
                <option value="">— {A.account} —</option>
                {usable.map((a) => <option key={a.code} value={a.code}>{a.code} {locale === 'en' ? a.name_en : a.name_th}</option>)}
              </NativeSelect>
              <Input type="number" inputMode="decimal" min={0} step="0.01" placeholder={A.debit} aria-label={A.debit} value={l.debit}
                onChange={(e) => set(i, { debit: e.target.value === '' ? '' : Number(e.target.value), credit: '' })} />
              <Input type="number" inputMode="decimal" min={0} step="0.01" placeholder={A.credit} aria-label={A.credit} value={l.credit}
                onChange={(e) => set(i, { credit: e.target.value === '' ? '' : Number(e.target.value), debit: '' })} />
              <Button type="button" variant="ghost" size="icon" aria-label={t.common.delete} disabled={lines.length <= 2}
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blank()])}><Plus /> {A.addLine}</Button>
            <span className="text-sm tabular-nums">{A.debit} {formatAmount(dr)} · {A.credit} {formatAmount(cr)}</span>
            {!balanced && dr + cr > 0 ? <span className="text-sm text-destructive">{A.unbalancedLines} ({formatAmount(Math.abs(dr - cr))})</span> : null}
          </div>
          <div><Button type="submit" size="lg" disabled={!balanced || post.pending}>{A.post}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

export function ReverseJournalButton({ id }: { id: string }) {
  const { t } = useI18n();
  const reverse = useAction(reverseJournalAction);
  return (
    <Button size="sm" variant="ghost" disabled={reverse.pending}
      onClick={() => { if (confirm(t.accounting.reverse + '?')) void reverse.run({ id }); }}>
      <Undo2 /> {t.accounting.reverse}
    </Button>
  );
}

export function PrintButton() {
  const { t } = useI18n();
  return <Button variant="outline" className="print:hidden" onClick={() => window.print()}><Printer /> {t.accounting.print}</Button>;
}

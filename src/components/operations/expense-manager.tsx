'use client';
import { useState } from 'react';
import { Ban, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { formToObject } from '@/lib/form';
import { recordExpenseAction, voidExpenseAction } from '@/server/actions/operations';
import { EXPENSE_CATEGORIES } from '@/domain/schemas/operations';
import { formatAmount } from '@/domain/money';
import { bangkokDate, formatDate } from '@/domain/datetime';
import type { ExpenseRow } from '@/lib/database.types';
import { matchIngredients, type IngredientOption } from '@/domain/ingredient-search';

/** Categories whose description is usually an ingredient (boxes and spoons are ingredients too). */
const INGREDIENT_CATEGORIES: readonly string[] = ['วัตถุดิบ', 'บรรจุภัณฑ์'];

export function ExpenseManager({ expenses, canVoid, ingredients = [] }: { expenses: ExpenseRow[]; canVoid: boolean; ingredients?: IngredientOption[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [voiding, setVoiding] = useState<ExpenseRow | null>(null);
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const suggestions = INGREDIENT_CATEGORIES.includes(category) ? matchIngredients(ingredients, description) : [];
  const record = useAction(recordExpenseAction);
  const voidIt = useAction(voidExpenseAction);
  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => { setCategory(EXPENSE_CATEGORIES[0]); setDescription(''); setOpen(true); }}><Plus /> {t.expenses.newExpense}</Button></div>
      <Table>
        <THead><TR><TH>{t.common.date}</TH><TH>{t.expenses.category}</TH><TH>{t.expenses.description}</TH><TH>{t.expenses.method}</TH><TH className="text-right">{t.expenses.amount}</TH><TH /></TR></THead>
        <TBody>
          {expenses.map((e) => (
            <TR key={e.id} className={e.voided_at ? 'opacity-50 line-through' : ''}>
              <TD>{formatDate(e.expense_date)}</TD><TD>{e.category}</TD><TD>{e.description}</TD>
              <TD>{t.pos.method[e.payment_method]}{e.cash_session_id ? <Badge variant="info" className="ml-1">{t.cash.title}</Badge> : null}</TD>
              <TD className="text-right tabular-nums">{formatAmount(e.amount)}</TD>
              <TD className="text-right">
                {e.voided_at ? <Badge variant="secondary">{t.expenses.voided}</Badge>
                  : canVoid ? <Button size="sm" variant="ghost" onClick={() => setVoiding(e)} aria-label={t.expenses.void}><Ban /></Button> : null}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.expenses.newExpense}</DialogTitle></DialogHeader>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); if (await record.run(formToObject(e.currentTarget))) setOpen(false); }}>
            <Field label={t.common.date}><Input type="date" name="expense_date" defaultValue={bangkokDate()} required /></Field>
            <Field label={t.expenses.category}>
              <NativeSelect name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t.expenses.description} className="sm:col-span-2" error={record.fieldErrors.description?.[0]}>
              <Input name="description" required autoComplete="off" value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder={INGREDIENT_CATEGORIES.includes(category) ? t.expenses.searchIngredient : undefined} />
              {suggestions.length ? (
                <ul className="mt-1 overflow-hidden rounded-xl border bg-card" aria-label={t.expenses.searchIngredient}>
                  {suggestions.map((o, i) => (
                    <li key={`${i}-${o.name_th}-${o.unit}`}>
                      <button type="button" className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-muted"
                        onClick={() => setDescription(o.name_th)}>
                        <span>{o.name_th}</span><span className="text-xs text-muted-foreground">{o.unit}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Field>
            <Field label={`${t.expenses.amount} (฿)`} error={record.fieldErrors.amount?.[0]}><Input name="amount" type="number" inputMode="decimal" min={0.01} step="0.01" required /></Field>
            <Field label={t.expenses.method}>
              <NativeSelect name="payment_method" defaultValue="CASH">
                {(['CASH', 'TRANSFER', 'QR', 'CARD'] as const).map((m) => <option key={m} value={m}>{t.pos.method[m]}</option>)}
              </NativeSelect>
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="from_drawer" className="size-5" /> {t.expenses.fromDrawer}</label>
            <DialogFooter className="sm:col-span-2"><Button type="submit" disabled={record.pending}>{t.common.save}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={voiding !== null} onOpenChange={(o) => !o && setVoiding(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.expenses.void}: {voiding?.description}</DialogTitle></DialogHeader>
          <form className="grid gap-4" onSubmit={async (e) => {
            e.preventDefault(); const fd = new FormData(e.currentTarget);
            if (voiding && await voidIt.run({ id: voiding.id, reason: fd.get('reason') })) setVoiding(null);
          }}>
            <Field label={t.common.reason}><Input name="reason" required /></Field>
            <DialogFooter><Button type="submit" variant="destructive" disabled={voidIt.pending}>{t.common.confirm}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

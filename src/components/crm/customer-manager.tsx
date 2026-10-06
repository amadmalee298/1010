'use client';
import { useState } from 'react';
import { History, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { formToObject } from '@/lib/form';
import { adjustPointsAction, saveCustomerAction } from '@/server/actions/customers';
import { formatAmount } from '@/domain/money';
import { formatDateTime } from '@/domain/datetime';
import type { CustomerPointsRow, CustomerRow } from '@/lib/database.types';

export function CustomerManager({ customers, history, canAdjust }: {
  customers: CustomerRow[]; history: Record<string, CustomerPointsRow[]>; canAdjust: boolean;
}) {
  const { t } = useI18n();
  const C = t.customers;
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<CustomerRow | 'new' | null>(null);
  const [viewing, setViewing] = useState<CustomerRow | null>(null);
  const save = useAction(saveCustomerAction);
  const adjust = useAction(adjustPointsAction);
  const cur = editing === 'new' ? null : editing;
  const q = filter.trim().toLowerCase();
  const visible = customers.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q.replace(/\D/g, '') || '§'));

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Input type="search" className="max-w-xs" placeholder={`${t.common.search}: ${t.common.name} / ${C.phone}`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Button className="ml-auto" onClick={() => setEditing('new')}><Plus /> {C.newCustomer}</Button>
      </div>
      <Table>
        <THead><TR><TH>{t.common.name}</TH><TH>{C.phone}</TH><TH className="text-right">{C.points}</TH><TH className="text-right">{C.totalSpent}</TH><TH className="text-right">{C.visits}</TH><TH /></TR></THead>
        <TBody>
          {visible.map((c) => (
            <TR key={c.id}>
              <TD className="font-medium">{c.name}{c.note ? <p className="text-xs text-muted-foreground">{c.note}</p> : null}</TD>
              <TD>{c.phone}</TD>
              <TD className="text-right"><Badge>{c.points_balance}</Badge></TD>
              <TD className="text-right tabular-nums">{formatAmount(c.total_spent)}</TD>
              <TD className="text-right">{c.visit_count}</TD>
              <TD className="whitespace-nowrap text-right">
                <Button size="sm" variant="ghost" onClick={() => setViewing(c)} aria-label={C.history}><History /></Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label={t.common.edit}><Pencil /></Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{cur ? C.editCustomer : C.newCustomer}</DialogTitle></DialogHeader>
          <form key={cur?.id ?? 'new'} className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => {
            e.preventDefault(); if (await save.run({ ...formToObject(e.currentTarget), id: cur?.id })) setEditing(null);
          }}>
            <Field label={t.common.name} error={save.fieldErrors.name?.[0]}><Input name="name" defaultValue={cur?.name} required /></Field>
            <Field label={C.phone} error={save.fieldErrors.phone?.[0]}><Input name="phone" inputMode="tel" defaultValue={cur?.phone ?? ''} /></Field>
            <Field label={C.email} error={save.fieldErrors.email?.[0]}><Input name="email" type="email" defaultValue={cur?.email ?? ''} /></Field>
            <Field label={C.birthday}><Input name="birthday" type="date" defaultValue={cur?.birthday ?? ''} /></Field>
            <Field label={t.common.note} className="sm:col-span-2"><Input name="note" defaultValue={cur?.note ?? ''} /></Field>
            <DialogFooter className="sm:col-span-2"><Button type="submit" disabled={save.pending}>{t.common.save}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-lg">
          {viewing ? (
            <>
              <DialogHeader><DialogTitle>{viewing.name} · {viewing.points_balance} {C.points}</DialogTitle></DialogHeader>
              <ul className="grid max-h-72 gap-1 overflow-y-auto text-sm">
                {(history[viewing.id] ?? []).map((h) => (
                  <li key={h.id} className="flex justify-between gap-2 border-b border-border py-1.5">
                    <span>{formatDateTime(h.created_at)} · {C.reason[h.reason]}{h.note ? ` · ${h.note}` : ''}</span>
                    <span className={`tabular-nums ${h.change < 0 ? 'text-destructive' : 'text-success-strong'}`}>{h.change > 0 ? '+' : ''}{h.change}</span>
                  </li>
                ))}
                {(history[viewing.id] ?? []).length === 0 ? <li className="text-muted-foreground">{t.common.noData}</li> : null}
              </ul>
              {canAdjust ? (
                <form className="grid gap-3 rounded-xl bg-muted/50 p-3" onSubmit={async (e) => {
                  e.preventDefault(); const fd = new FormData(e.currentTarget);
                  if (await adjust.run({ customer_id: viewing.id, change: fd.get('change'), note: fd.get('note') })) setViewing(null);
                }}>
                  <p className="font-medium">{C.adjustPoints}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="change" type="number" step={1} placeholder={C.change} required />
                    <Input name="note" placeholder={t.common.reason} required />
                  </div>
                  <Button type="submit" disabled={adjust.pending}>{t.common.save}</Button>
                </form>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

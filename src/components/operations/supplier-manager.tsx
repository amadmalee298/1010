'use client';
import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { formToObject } from '@/lib/form';
import { saveSupplierAction } from '@/server/actions/operations';
import type { SupplierRow } from '@/lib/database.types';

export function SupplierManager({ suppliers }: { suppliers: SupplierRow[] }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<SupplierRow | 'new' | null>(null);
  const save = useAction(saveSupplierAction);
  const cur = editing === 'new' ? null : editing;
  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing('new')}><Plus /> {t.purchasing.newSupplier}</Button></div>
      <Table>
        <THead><TR><TH>{t.common.name}</TH><TH>{t.purchasing.contact}</TH><TH>{t.purchasing.phone}</TH><TH>{t.purchasing.taxId}</TH><TH>{t.common.status}</TH><TH /></TR></THead>
        <TBody>
          {suppliers.map((s) => (
            <TR key={s.id} className={s.is_active ? '' : 'opacity-50'}>
              <TD className="font-medium">{s.name}</TD><TD>{s.contact_name}</TD><TD>{s.phone}</TD><TD>{s.tax_id}</TD>
              <TD><Badge variant={s.is_active ? 'success' : 'secondary'}>{s.is_active ? t.common.active : t.common.inactive}</Badge></TD>
              <TD className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={t.common.edit}><Pencil /></Button></TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{cur ? t.purchasing.editSupplier : t.purchasing.newSupplier}</DialogTitle></DialogHeader>
          <form key={cur?.id ?? 'new'} className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => {
            e.preventDefault(); if (await save.run({ ...formToObject(e.currentTarget), id: cur?.id })) setEditing(null);
          }}>
            <Field label={t.common.name} error={save.fieldErrors.name?.[0]}><Input name="name" defaultValue={cur?.name} required /></Field>
            <Field label={t.purchasing.contact}><Input name="contact_name" defaultValue={cur?.contact_name ?? ''} /></Field>
            <Field label={t.purchasing.phone}><Input name="phone" inputMode="tel" defaultValue={cur?.phone ?? ''} /></Field>
            <Field label={t.purchasing.email} error={save.fieldErrors.email?.[0]}><Input name="email" type="email" defaultValue={cur?.email ?? ''} /></Field>
            <Field label={t.purchasing.taxId}><Input name="tax_id" defaultValue={cur?.tax_id ?? ''} /></Field>
            <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" name="is_active" defaultChecked={cur?.is_active ?? true} className="size-5" /> {t.common.active}</label>
            <Field label={t.purchasing.address} className="sm:col-span-2"><Textarea name="address" defaultValue={cur?.address ?? ''} /></Field>
            <Field label={t.common.note} className="sm:col-span-2"><Input name="note" defaultValue={cur?.note ?? ''} /></Field>
            <DialogFooter className="sm:col-span-2"><Button type="submit" disabled={save.pending}>{t.common.save}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

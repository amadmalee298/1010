'use client';
import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { formToObject } from '@/lib/form';
import { savePromotionAction } from '@/server/actions/customers';
import { formatAmount } from '@/domain/money';
import { formatDateTime } from '@/domain/datetime';
import type { PromotionRow } from '@/lib/database.types';

/** UTC instant → value for <input type="datetime-local"> in Bangkok time. */
const toLocalInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 16) : '');

export function PromotionManager({ promotions }: { promotions: PromotionRow[] }) {
  const { t } = useI18n();
  const P = t.promotions;
  const [editing, setEditing] = useState<PromotionRow | 'new' | null>(null);
  const save = useAction(savePromotionAction);
  const cur = editing === 'new' ? null : editing;
  return (
    <>
      <div className="mb-4 flex justify-end"><Button onClick={() => setEditing('new')}><Plus /> {P.newPromotion}</Button></div>
      <Table>
        <THead><TR><TH>{t.common.name}</TH><TH>{P.code}</TH><TH>{P.value}</TH><TH>{P.minSubtotal}</TH><TH>{P.startsAt} – {P.endsAt}</TH><TH>{t.common.status}</TH><TH /></TR></THead>
        <TBody>
          {promotions.map((p) => (
            <TR key={p.id} className={p.is_active ? '' : 'opacity-50'}>
              <TD className="font-medium">{p.name}{p.members_only ? <Badge variant="info" className="ml-2">{P.membersOnly}</Badge> : null}</TD>
              <TD>{p.code ?? '—'}</TD>
              <TD>{p.discount_type === 'PERCENT' ? `${p.value}%` : `฿${formatAmount(p.value)}`}{p.max_discount ? ` (≤ ฿${formatAmount(p.max_discount)})` : ''}</TD>
              <TD>{p.min_subtotal ? `฿${formatAmount(p.min_subtotal)}` : '—'}</TD>
              <TD className="text-xs">{p.starts_at ? formatDateTime(p.starts_at) : '…'} – {p.ends_at ? formatDateTime(p.ends_at) : '…'}</TD>
              <TD><Badge variant={p.is_active ? 'success' : 'secondary'}>{p.is_active ? t.common.active : t.common.inactive}</Badge></TD>
              <TD className="text-right"><Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label={t.common.edit}><Pencil /></Button></TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{cur ? P.editPromotion : P.newPromotion}</DialogTitle></DialogHeader>
          <form key={cur?.id ?? 'new'} className="grid gap-4 sm:grid-cols-2" onSubmit={async (e) => {
            e.preventDefault(); if (await save.run({ ...formToObject(e.currentTarget), id: cur?.id })) setEditing(null);
          }}>
            <Field label={t.common.name} error={save.fieldErrors.name?.[0]}><Input name="name" defaultValue={cur?.name} required /></Field>
            <Field label={P.code} error={save.fieldErrors.code?.[0]}><Input name="code" defaultValue={cur?.code ?? ''} className="uppercase" /></Field>
            <Field label={P.type}>
              <NativeSelect name="discount_type" defaultValue={cur?.discount_type ?? 'PERCENT'}>
                <option value="PERCENT">{P.percent}</option><option value="FIXED">{P.fixed}</option>
              </NativeSelect>
            </Field>
            <Field label={P.value} error={save.fieldErrors.value?.[0]}><Input name="value" type="number" min={0.01} step="0.01" defaultValue={cur?.value ?? ''} required /></Field>
            <Field label={P.minSubtotal}><Input name="min_subtotal" type="number" min={0} step="0.01" defaultValue={cur?.min_subtotal ?? 0} /></Field>
            <Field label={P.maxDiscount}><Input name="max_discount" type="number" min={0} step="0.01" defaultValue={cur?.max_discount ?? ''} /></Field>
            <Field label={P.startsAt}><Input name="starts_at" type="datetime-local" defaultValue={toLocalInput(cur?.starts_at ?? null)} /></Field>
            <Field label={P.endsAt} error={save.fieldErrors.ends_at?.[0]}><Input name="ends_at" type="datetime-local" defaultValue={toLocalInput(cur?.ends_at ?? null)} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="members_only" defaultChecked={cur?.members_only ?? false} className="size-5" /> {P.membersOnly}</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={cur?.is_active ?? true} className="size-5" /> {t.common.active}</label>
            <DialogFooter className="sm:col-span-2"><Button type="submit" disabled={save.pending}>{t.common.save}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

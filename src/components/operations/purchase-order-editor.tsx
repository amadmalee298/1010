'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackageCheck, Plus, Send, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { receivePurchaseAction, savePurchaseOrderAction, setPurchaseStatusAction } from '@/server/actions/operations';
import { formatAmount, formatQty, round2 } from '@/domain/money';
import type { IngredientRow, PurchaseItemRow, PurchaseOrderRow, SupplierRow } from '@/lib/database.types';

interface Line { key: number; ingredientId: string; quantity: string; unitCost: string }

export function PurchaseOrderEditor({ po, items, suppliers, ingredients }: {
  po: PurchaseOrderRow | null; items: PurchaseItemRow[]; suppliers: SupplierRow[]; ingredients: IngredientRow[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const editable = !po || po.status === 'DRAFT';
  const receivable = !!po && (po.status === 'DRAFT' || po.status === 'ORDERED');
  const [supplierId, setSupplierId] = useState(po?.supplier_id ?? suppliers[0]?.id ?? '');
  const [expected, setExpected] = useState(po?.expected_date ?? '');
  const [note, setNote] = useState(po?.note ?? '');
  const [lines, setLines] = useState<Line[]>(items.length
    ? items.map((i, k) => ({ key: k, ingredientId: i.ingredient_id, quantity: String(i.quantity), unitCost: String(i.unit_cost) }))
    : [{ key: 0, ingredientId: '', quantity: '', unitCost: '' }]);
  const [receive, setReceive] = useState<Record<string, { quantity: string; unitCost: string }>>(
    Object.fromEntries(items.map((i) => [i.id, { quantity: String(Math.max(0, i.quantity - i.received_quantity)), unitCost: String(i.unit_cost) }])));
  const [paidFromDrawer, setPaidFromDrawer] = useState(false);
  const save = useAction(savePurchaseOrderAction);
  const status = useAction(setPurchaseStatusAction);
  const recv = useAction(receivePurchaseAction, { successMessage: t.purchasing.received });
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const subtotal = round2(lines.reduce((s, l) => s + round2(Number(l.quantity || 0) * Number(l.unitCost || 0)), 0));
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit() {
    const res = await save.run({
      id: po?.id, supplier_id: supplierId, expected_date: expected, note,
      items: lines.filter((l) => l.ingredientId).map((l) => ({ ingredient_id: l.ingredientId, quantity: l.quantity, unit_cost: l.unitCost })),
    });
    if (res && !po) router.push(`/purchasing/${res.id}`);
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t.purchasing.supplier}>
          <NativeSelect value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={!editable}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label={t.purchasing.expectedDate}><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} disabled={!editable} /></Field>
        <Field label={t.common.note}><Input value={note} onChange={(e) => setNote(e.target.value)} disabled={!editable} /></Field>
      </div>

      {editable ? (
        <>
          <Table>
            <THead><TR><TH>{t.nav.ingredients}</TH><TH className="w-36">{t.common.quantity}</TH><TH className="w-36">{t.common.cost}/{t.common.unit}</TH><TH className="text-right">{t.common.total}</TH><TH /></TR></THead>
            <TBody>
              {lines.map((l) => (
                <TR key={l.key}>
                  <TD>
                    <NativeSelect value={l.ingredientId} onChange={(e) => update(l.key, { ingredientId: e.target.value, unitCost: l.unitCost || String(byId.get(e.target.value)?.avg_cost ?? '') })}>
                      <option value="">{t.catalog.selectIngredient}</option>
                      {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name_th} ({i.unit})</option>)}
                    </NativeSelect>
                  </TD>
                  <TD><Input type="number" inputMode="decimal" min={0} step="any" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} /></TD>
                  <TD><Input type="number" inputMode="decimal" min={0} step="any" value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })} /></TD>
                  <TD className="text-right tabular-nums">{formatAmount(Number(l.quantity || 0) * Number(l.unitCost || 0))}</TD>
                  <TD><Button size="icon" variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t.common.delete}><Trash2 /></Button></TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setLines((ls) => [...ls, { key: Math.max(0, ...ls.map((x) => x.key)) + 1, ingredientId: '', quantity: '', unitCost: '' }])}><Plus /> {t.purchasing.addLine}</Button>
            <span className="ml-auto font-semibold">{t.purchasing.subtotal}: ฿{formatAmount(subtotal)}</span>
            <Button onClick={submit} disabled={save.pending}>{t.common.save}</Button>
            {po ? <Button variant="secondary" onClick={() => status.run({ id: po.id, status: 'ORDERED' })} disabled={status.pending}><Send /> {t.purchasing.markOrdered}</Button> : null}
          </div>
        </>
      ) : null}

      {receivable ? (
        <section className="grid gap-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="font-semibold">{t.purchasing.receive}</h2>
          <p className="text-xs text-muted-foreground">{t.purchasing.inventoryNote}</p>
          <Table>
            <THead><TR><TH>{t.nav.ingredients}</TH><TH className="text-right">{t.purchasing.ordered}</TH><TH className="text-right">{t.purchasing.received}</TH><TH className="w-32">{t.purchasing.receiveQty}</TH><TH className="w-32">{t.purchasing.actualCost}</TH></TR></THead>
            <TBody>
              {items.map((i) => (
                <TR key={i.id}>
                  <TD>{byId.get(i.ingredient_id)?.name_th}</TD>
                  <TD className="text-right">{formatQty(i.quantity)}</TD>
                  <TD className="text-right">{formatQty(i.received_quantity)}</TD>
                  <TD><Input type="number" min={0} max={i.quantity - i.received_quantity} step="any" value={receive[i.id]?.quantity ?? ''} disabled={i.received_quantity >= i.quantity}
                    onChange={(e) => setReceive((r) => ({ ...r, [i.id]: { quantity: e.target.value, unitCost: r[i.id]?.unitCost ?? String(i.unit_cost) } }))} /></TD>
                  <TD><Input type="number" min={0} step="any" value={receive[i.id]?.unitCost ?? ''} disabled={i.received_quantity >= i.quantity}
                    onChange={(e) => setReceive((r) => ({ ...r, [i.id]: { quantity: r[i.id]?.quantity ?? '0', unitCost: e.target.value } }))} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={paidFromDrawer} onChange={(e) => setPaidFromDrawer(e.target.checked)} /> {t.purchasing.paidFromDrawer}</label>
          <div className="flex flex-wrap gap-2">
            <Button variant="success" disabled={recv.pending} onClick={() => recv.run({
              id: po.id, paid_from_drawer: paidFromDrawer,
              items: items.map((i) => ({ purchase_item_id: i.id, quantity: receive[i.id]?.quantity ?? '0', unit_cost: receive[i.id]?.unitCost })),
            })}><PackageCheck /> {t.purchasing.receive}</Button>
            {!items.some((i) => i.received_quantity > 0) ? (
              <Button variant="ghost" className="text-destructive" disabled={status.pending} onClick={() => status.run({ id: po.id, status: 'CANCELLED' })}><XCircle /> {t.purchasing.cancelPo}</Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

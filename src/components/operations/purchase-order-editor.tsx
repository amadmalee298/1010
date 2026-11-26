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
import { formatAmount, formatQty, round2, round4 } from '@/domain/money';
import { hasPack } from '@/components/inventory/pack-quantity-input';
import type { IngredientRow, PurchaseItemRow, PurchaseOrderRow, SupplierRow } from '@/lib/database.types';

/** A draft line; with `packs` the quantity and cost are per pack ("2 แผง × 150") and are turned into base units on save. */
interface Line { key: number; ingredientId: string; quantity: string; unitCost: string; packs: boolean }

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
    ? items.map((i, k) => ({ key: k, ingredientId: i.ingredient_id, quantity: String(i.quantity), unitCost: String(i.unit_cost), packs: false }))
    : [{ key: 0, ingredientId: '', quantity: '', unitCost: '', packs: false }]);
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
      items: lines.filter((l) => l.ingredientId).map((l) => {
        const ing = byId.get(l.ingredientId);
        if (!l.packs || !ing || !hasPack(ing)) return { ingredient_id: l.ingredientId, quantity: l.quantity, unit_cost: l.unitCost };
        return {
          ingredient_id: l.ingredientId,
          quantity: String(round4(Number(l.quantity || 0) * ing.pack_size)),
          unit_cost: String(round4(Number(l.unitCost || 0) / ing.pack_size)),
        };
      }),
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
          <div className="grid gap-3">
            {lines.map((l) => {
              const ing = byId.get(l.ingredientId);
              const pack = ing && hasPack(ing) ? ing : null;
              return (
                <div key={l.key} className="grid gap-3 rounded-2xl border border-border bg-card p-3">
                  <div className="flex items-center gap-2">
                    <NativeSelect className="flex-1" value={l.ingredientId} onChange={(e) => {
                      const next = byId.get(e.target.value);
                      // Bought by the pack: count packs at the pack's last price; otherwise base units at average cost.
                      if (next && hasPack(next)) update(l.key, { ingredientId: next.id, packs: true, quantity: l.quantity || '1', unitCost: next.pack_price !== null ? String(next.pack_price) : String(round2(next.avg_cost * next.pack_size)) });
                      else update(l.key, { ingredientId: e.target.value, packs: false, unitCost: l.unitCost || String(next?.avg_cost ?? '') });
                    }}>
                      <option value="">{t.catalog.selectIngredient}</option>
                      {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name_th} ({i.unit})</option>)}
                    </NativeSelect>
                    <Button size="icon" variant="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t.common.delete}><Trash2 /></Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t.common.quantity}>
                      <div className="flex items-center gap-1">
                        <Input type="number" inputMode="decimal" min={0} step="any" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} />
                        {pack ? (
                          <Button type="button" variant="ghost" size="sm" className="shrink-0 px-1 font-semibold text-primary" onClick={() => update(l.key, l.packs
                            ? { packs: false, quantity: l.quantity && String(round4(Number(l.quantity) * pack.pack_size)), unitCost: l.unitCost && String(round4(Number(l.unitCost) / pack.pack_size)) }
                            : { packs: true, quantity: l.quantity && String(round4(Number(l.quantity) / pack.pack_size)), unitCost: l.unitCost && String(round2(Number(l.unitCost) * pack.pack_size)) })}>
                            {l.packs ? pack.pack_unit : pack.unit} ⇄
                          </Button>
                        ) : ing ? <span className="shrink-0 text-xs text-muted-foreground">{ing.unit}</span> : null}
                      </div>
                      {pack && l.packs && l.quantity ? <p className="text-xs text-muted-foreground">= {formatQty(Number(l.quantity) * pack.pack_size)} {pack.unit}</p> : null}
                    </Field>
                    <Field label={`${t.common.cost}/${pack && l.packs ? pack.pack_unit : ing?.unit ?? t.common.unit}`}>
                      <Input type="number" inputMode="decimal" min={0} step="any" value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })} />
                    </Field>
                  </div>
                  <p className="text-right text-sm">{t.common.total}: <span className="font-semibold tabular-nums">฿{formatAmount(Number(l.quantity || 0) * Number(l.unitCost || 0))}</span></p>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setLines((ls) => [...ls, { key: Math.max(0, ...ls.map((x) => x.key)) + 1, ingredientId: '', quantity: '', unitCost: '', packs: false }])}><Plus /> {t.purchasing.addLine}</Button>
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

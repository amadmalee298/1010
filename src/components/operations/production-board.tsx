'use client';
import { useState } from 'react';
import { Factory, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import {
  cancelProductionAction, completeProductionAction, createProductionAction, productionRequirementsAction,
} from '@/server/actions/operations';
import { formatAmount, formatQty } from '@/domain/money';
import { formatDateTime } from '@/domain/datetime';
import type { ProductionRequirementRow, ProductionRow } from '@/lib/database.types';

export interface ProducibleProduct { id: string; name: string; yieldPerBatch: number }

export function ProductionBoard({ runs, products, productNames }: { runs: ProductionRow[]; products: ProducibleProduct[]; productNames: Record<string, string> }) {
  const { t } = useI18n();
  const [planOpen, setPlanOpen] = useState(false);
  const [selected, setSelected] = useState<ProductionRow | null>(null);
  const [reqs, setReqs] = useState<ProductionRequirementRow[] | null>(null);
  const [productId, setProductId] = useState(products[0]?.id ?? '');
  const [batches, setBatches] = useState('1');
  const create = useAction(createProductionAction);
  const complete = useAction(completeProductionAction, { successMessage: t.production.completedNote });
  const cancel = useAction(cancelProductionAction);
  const loadReqs = useAction(productionRequirementsAction, { successMessage: false, refresh: false });
  const yieldPerBatch = products.find((p) => p.id === productId)?.yieldPerBatch ?? 0;

  async function openRun(run: ProductionRow) {
    setSelected(run);
    setReqs(run.status === 'PLANNED' ? await loadReqs.run({ production_id: run.id }) : null);
  }
  const short = reqs?.some((r) => r.shortage > 0) ?? false;
  const estimated = reqs?.reduce((s, r) => s + r.required_quantity * r.unit_cost, 0) ?? 0;

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setPlanOpen(true)} disabled={!products.length}><Plus /> {t.production.newProduction}</Button>
      </div>
      {!products.length ? <p className="mb-4 rounded-xl bg-warning/20 p-3 text-sm">{t.production.onlyFinished}</p> : null}
      <Table>
        <THead><TR><TH>{t.production.number}</TH><TH>{t.production.product}</TH><TH className="text-right">{t.production.batches}</TH><TH className="text-right">{t.production.planned}</TH><TH className="text-right">{t.production.actual}</TH><TH className="text-right">{t.production.unitCost}</TH><TH>{t.common.status}</TH><TH>{t.common.date}</TH></TR></THead>
        <TBody>
          {runs.map((r) => (
            <TR key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => void openRun(r)}>
              <TD className="font-medium">{r.production_number}</TD>
              <TD>{productNames[r.product_id] ?? '—'}</TD>
              <TD className="text-right">{formatQty(r.batches)}</TD>
              <TD className="text-right">{formatQty(r.planned_output)}</TD>
              <TD className="text-right">{r.actual_output === null ? '—' : formatQty(r.actual_output)}</TD>
              <TD className="text-right tabular-nums">{r.unit_cost === null ? '—' : formatAmount(r.unit_cost)}</TD>
              <TD><Badge variant={r.status === 'COMPLETED' ? 'success' : r.status === 'PLANNED' ? 'warning' : 'secondary'}>{t.production.status[r.status]}</Badge></TD>
              <TD className="whitespace-nowrap text-xs">{formatDateTime(r.completed_at ?? r.created_at)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.production.newProduction}</DialogTitle></DialogHeader>
          <form className="grid gap-4" onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            if (await create.run({ product_id: productId, batches, note: fd.get('note') })) setPlanOpen(false);
          }}>
            <Field label={t.production.product}>
              <NativeSelect value={productId} onChange={(e) => setProductId(e.target.value)}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({formatQty(p.yieldPerBatch)}/{t.catalog.perBatch})</option>)}
              </NativeSelect>
            </Field>
            <Field label={t.production.batches} hint={`${t.production.planned}: ${formatQty(Number(batches || 0) * yieldPerBatch)}`}>
              <Input type="number" inputMode="decimal" min={0.01} step="any" value={batches} onChange={(e) => setBatches(e.target.value)} required />
            </Field>
            <Field label={t.common.note}><Input name="note" /></Field>
            <DialogFooter><Button type="submit" disabled={create.pending}><Factory /> {t.common.create}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={selected !== null} onOpenChange={(o) => { if (!o) { setSelected(null); setReqs(null); } }}>
        <DialogContent className="max-w-xl">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.production_number} · {productNames[selected.product_id]}</DialogTitle>
                <DialogDescription>{formatQty(selected.batches)} × {formatQty(selected.yield_per_batch)} = {formatQty(selected.planned_output)}</DialogDescription>
              </DialogHeader>
              {selected.status === 'PLANNED' ? (
                <>
                  <h3 className="font-medium">{t.production.requirements}</h3>
                  <Table>
                    <THead><TR><TH>{t.common.name}</TH><TH className="text-right">{t.common.quantity}</TH><TH className="text-right">{t.catalog.stock}</TH><TH className="text-right">{t.production.shortage}</TH></TR></THead>
                    <TBody>
                      {(reqs ?? []).map((r) => (
                        <TR key={r.ingredient_id}>
                          <TD>{r.name_th}</TD>
                          <TD className="text-right">{formatQty(r.required_quantity)} {r.unit}</TD>
                          <TD className="text-right">{formatQty(r.stock_qty)}</TD>
                          <TD className="text-right">{r.shortage > 0 ? <Badge variant="destructive">{formatQty(r.shortage)}</Badge> : '✓'}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                  <p className="text-sm text-muted-foreground">{t.production.totalCost} ≈ ฿{formatAmount(estimated)}</p>
                  <form className="grid gap-3" onSubmit={async (e) => {
                    e.preventDefault(); const fd = new FormData(e.currentTarget);
                    if (await complete.run({ production_id: selected.id, actual_output: fd.get('actual_output') })) { setSelected(null); setReqs(null); }
                  }}>
                    <Field label={t.production.actual}><Input name="actual_output" type="number" inputMode="decimal" min={0} step="any" placeholder={String(selected.planned_output)} /></Field>
                    <DialogFooter>
                      <Button type="button" variant="ghost" disabled={cancel.pending} onClick={async () => { if (await cancel.run({ production_id: selected.id })) setSelected(null); }}>{t.production.cancel}</Button>
                      <Button type="submit" variant="success" disabled={complete.pending || short}>{t.production.complete}</Button>
                    </DialogFooter>
                  </form>
                </>
              ) : (
                <div className="grid gap-1 text-sm">
                  <p>{t.production.actual}: {selected.actual_output === null ? '—' : formatQty(selected.actual_output)}</p>
                  <p>{t.production.totalCost}: ฿{selected.total_cost === null ? '—' : formatAmount(selected.total_cost)}</p>
                  <p>{t.production.unitCost}: ฿{selected.unit_cost === null ? '—' : formatAmount(selected.unit_cost)}</p>
                </div>
              )}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

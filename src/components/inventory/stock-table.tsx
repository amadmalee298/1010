'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { formToObject } from '@/lib/form';
import { formatAmount, formatQty } from '@/domain/money';
import { adjustStockAction, recordWasteAction, stockCountAction } from '@/server/actions/inventory';
import type { StockLevelRow } from '@/lib/database.types';

type Mode = 'count' | 'adjust' | 'waste';

export function StockTable({ items, canManage }: { items: StockLevelRow[]; canManage: boolean }) {
  const { t } = useI18n();
  const [target, setTarget] = useState<{ item: StockLevelRow; mode: Mode } | null>(null);
  const [filter, setFilter] = useState('');
  const count = useAction(stockCountAction);
  const adjust = useAction(adjustStockAction);
  const waste = useAction(recordWasteAction);
  const pending = count.pending || adjust.pending || waste.pending;
  const visible = items.filter((i) => !filter || i.name_th.toLowerCase().includes(filter.toLowerCase()));

  async function submit(form: HTMLFormElement) {
    if (!target) return;
    const data = { ...formToObject(form), ingredient_id: target.item.id };
    const ok = target.mode === 'count' ? await count.run(data) : target.mode === 'adjust' ? await adjust.run(data) : await waste.run(data);
    if (ok !== null || target.mode === 'count') setTarget(null);
  }

  return (
    <>
      <Input placeholder={t.common.search} value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-3 max-w-xs" type="search" />
      <Table>
        <THead>
          <TR>
            <TH>{t.common.name}</TH><TH className="text-right">{t.catalog.stock}</TH><TH className="text-right">{t.catalog.reorderLevel}</TH>
            {canManage ? <TH className="text-right">{t.catalog.avgCost}</TH> : null}
            {canManage ? <TH className="text-right">{t.inventory.stockValue}</TH> : null}
            <TH />
          </TR>
        </THead>
        <TBody>
          {visible.map((i) => (
            <TR key={i.id}>
              <TD>
                <p className="font-medium">{i.name_th}</p>
                <p className="text-xs text-muted-foreground">{i.item_type === 'FINISHED' ? t.catalog.finished : t.catalog.raw}</p>
              </TD>
              <TD className="text-right tabular-nums">
                {formatQty(i.stock_qty)} <span className="text-xs text-muted-foreground">{i.unit}</span>
                {i.is_low ? <Badge variant="destructive" className="ml-2">{t.catalog.lowStock}</Badge> : null}
              </TD>
              <TD className="text-right tabular-nums">{formatQty(i.reorder_level)}</TD>
              {canManage ? <TD className="text-right tabular-nums">{formatAmount(i.avg_cost)}</TD> : null}
              {canManage ? <TD className="text-right tabular-nums">{formatAmount(i.stock_value)}</TD> : null}
              <TD className="whitespace-nowrap text-right">
                {canManage ? <Button size="sm" variant="outline" onClick={() => setTarget({ item: i, mode: 'count' })}>{t.inventory.count}</Button> : null}{' '}
                {canManage ? <Button size="sm" variant="outline" onClick={() => setTarget({ item: i, mode: 'adjust' })}>{t.inventory.adjust}</Button> : null}{' '}
                <Button size="sm" variant="outline" onClick={() => setTarget({ item: i, mode: 'waste' })}>{t.inventory.waste}</Button>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          {target ? (
            <>
              <DialogHeader>
                <DialogTitle>{t.inventory[target.mode]}: {target.item.name_th}</DialogTitle>
                <DialogDescription>{t.inventory.currentStock}: {formatQty(target.item.stock_qty)} {target.item.unit}</DialogDescription>
              </DialogHeader>
              <form key={`${target.item.id}-${target.mode}`} className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }}>
                {target.mode === 'count' ? (
                  <>
                    <Field label={`${t.inventory.counted} (${target.item.unit})`}><Input name="counted" type="number" inputMode="decimal" min={0} step="any" required autoFocus /></Field>
                    <Field label={t.common.note}><Input name="note" /></Field>
                  </>
                ) : target.mode === 'adjust' ? (
                  <>
                    <Field label={`${t.inventory.delta} (${target.item.unit})`}><Input name="delta" type="number" inputMode="decimal" step="any" required autoFocus /></Field>
                    <Field label={t.inventory.unitCostIn}><Input name="unit_cost" type="number" inputMode="decimal" min={0} step="any" /></Field>
                    <Field label={t.common.reason}><Input name="note" required /></Field>
                  </>
                ) : (
                  <>
                    <Field label={`${t.common.quantity} (${target.item.unit})`}><Input name="quantity" type="number" inputMode="decimal" min={0} step="any" required autoFocus /></Field>
                    <Field label={t.inventory.wasteReason}><Input name="reason" required /></Field>
                  </>
                )}
                <DialogFooter><Button type="submit" disabled={pending}>{t.common.save}</Button></DialogFooter>
              </form>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

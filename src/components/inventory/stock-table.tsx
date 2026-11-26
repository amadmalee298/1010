'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { formToObject } from '@/lib/form';
import { formatAmount, formatQty, formatUnitCost, round4 } from '@/domain/money';
import { adjustStockAction, setStockCostAction, stockCountAction } from '@/server/actions/inventory';
import { WasteDialog } from './waste-dialog';
import { hasPack, PackQuantityInput } from './pack-quantity-input';
import type { StockLevelRow } from '@/lib/database.types';

type Mode = 'count' | 'adjust' | 'cost';

export function StockTable({ items, canManage }: { items: StockLevelRow[]; canManage: boolean }) {
  const { t } = useI18n();
  const [target, setTarget] = useState<{ item: StockLevelRow; mode: Mode } | null>(null);
  const [filter, setFilter] = useState('');
  // iPhone number pads have no minus key, so the direction is a toggle and the amount is always positive.
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const count = useAction(stockCountAction);
  const adjust = useAction(adjustStockAction);
  const setCost = useAction(setStockCostAction);
  const pending = count.pending || adjust.pending || setCost.pending;
  const [wasteItem, setWasteItem] = useState<StockLevelRow | null>(null);
  // Set quantity + price in one step: "bought 30 eggs for 120 THB" gives 4.00 per egg.
  const [costQty, setCostQty] = useState('');
  const [countQty, setCountQty] = useState('');
  const [adjustQty, setAdjustQty] = useState('');
  const [packPrice, setPackPrice] = useState('');
  const [packSize, setPackSize] = useState('1');
  const unitCost = Number(packSize) > 0 && packPrice !== '' ? round4(Number(packPrice) / Number(packSize)) : null;

  function open(item: StockLevelRow, mode: Mode) {
    setDirection('in');
    setCostQty(item.stock_qty > 0 ? String(item.stock_qty) : '');
    setCountQty('');
    setAdjustQty('');
    // Bought by the pack: start from the pack's last price ("150 บาท ได้ 30 ฟอง").
    setPackPrice(hasPack(item) && item.pack_price !== null ? String(item.pack_price) : '');
    setPackSize(hasPack(item) ? String(item.pack_size) : '1');
    setTarget({ item, mode });
  }
  const visible = items.filter((i) => !filter || i.name_th.toLowerCase().includes(filter.toLowerCase()));

  async function submit(form: HTMLFormElement) {
    if (!target) return;
    const data: Record<string, unknown> = { ...formToObject(form), ingredient_id: target.item.id };
    if (target.mode === 'adjust') {
      const amount = Math.abs(Number(data.amount));
      if (!(amount > 0)) { toast.error(t.inventory.amountPositive); return; }
      delete data.amount;
      data.delta = direction === 'out' ? -amount : amount;
      if (direction === 'out') delete data.unit_cost;
    }
    if (target.mode === 'cost') {
      if (unitCost === null) { toast.error(t.inventory.pricePositive); return; }
      const ok = await setCost.run({ ingredient_id: target.item.id, quantity: costQty, unit_cost: unitCost, note: data.note });
      if (ok !== null) setTarget(null);
      return;
    }
    const ok = target.mode === 'count' ? await count.run(data) : await adjust.run(data);
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
              {canManage ? <TD className="text-right tabular-nums">{formatUnitCost(i.avg_cost)}</TD> : null}
              {canManage ? <TD className="text-right tabular-nums">{formatAmount(i.stock_value)}</TD> : null}
              <TD className="whitespace-nowrap text-right">
                {canManage ? <Button size="sm" onClick={() => open(i, 'cost')}>{t.inventory.cost}</Button> : null}{' '}
                {canManage ? <Button size="sm" variant="outline" onClick={() => open(i, 'count')}>{t.inventory.count}</Button> : null}{' '}
                {canManage ? <Button size="sm" variant="outline" onClick={() => open(i, 'adjust')}>{t.inventory.adjust}</Button> : null}{' '}
                <Button size="sm" variant="outline" onClick={() => setWasteItem(i)}>{t.inventory.waste}</Button>
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
                    <Field label={t.inventory.counted}><PackQuantityInput item={target.item} name="counted" value={countQty} onChange={setCountQty} required autoFocus /></Field>
                    <Field label={t.common.note}><Input name="note" /></Field>
                  </>
                ) : target.mode === 'adjust' ? (
                  <>
                    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t.inventory.direction}>
                      <Button type="button" role="radio" aria-checked={direction === 'in'} variant={direction === 'in' ? 'default' : 'outline'} onClick={() => setDirection('in')}>{t.inventory.add}</Button>
                      <Button type="button" role="radio" aria-checked={direction === 'out'} variant={direction === 'out' ? 'default' : 'outline'} onClick={() => setDirection('out')}>{t.inventory.remove}</Button>
                    </div>
                    <Field label={direction === 'in' ? t.inventory.addQty : t.inventory.removeQty}>
                      <PackQuantityInput item={target.item} name="amount" value={adjustQty} onChange={setAdjustQty} required autoFocus />
                    </Field>
                    {direction === 'in' ? <Field label={`${t.inventory.unitCostIn} (฿/${target.item.unit})`}><Input name="unit_cost" type="number" inputMode="decimal" min={0} step="any" /></Field> : null}
                    <Field label={t.common.reason}><Input name="note" required /></Field>
                  </>
                ) : target.mode === 'cost' ? (
                  <>
                    <Field label={t.inventory.onHand}>
                      <PackQuantityInput item={target.item} value={costQty} onChange={setCostQty} required />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={t.inventory.packPrice}>
                        <Input type="number" inputMode="decimal" min={0} step="any" required autoFocus value={packPrice} onChange={(e) => setPackPrice(e.target.value)} />
                      </Field>
                      <Field label={`${t.inventory.packSize} (${target.item.unit})`}>
                        <Input type="number" inputMode="decimal" min={0.0001} step="any" required value={packSize} onChange={(e) => setPackSize(e.target.value)} />
                      </Field>
                    </div>
                    <p className="rounded-xl bg-muted p-3 text-sm">
                      {t.inventory.unitCostResult}: <span className="font-semibold tabular-nums">{unitCost === null ? '—' : `฿${formatUnitCost(unitCost)}/${target.item.unit}`}</span>
                    </p>
                    <Field label={t.common.note}><Input name="note" placeholder={t.inventory.costNoteHint} /></Field>
                  </>
                ) : null}
                <DialogFooter><Button type="submit" disabled={pending}>{t.common.save}</Button></DialogFooter>
              </form>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
      <WasteDialog item={wasteItem} onClose={() => setWasteItem(null)} />
    </>
  );
}

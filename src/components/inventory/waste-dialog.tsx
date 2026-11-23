'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { formatQty } from '@/domain/money';
import { recordWasteAction } from '@/server/actions/inventory';

export const WASTE_REASONS = ['หมดอายุ', 'เสีย', 'ทำหก', 'ตกแตก'] as const;

export interface WasteItem { id: string; name_th: string; unit: string; stock_qty: number }

/** Record expired / spoiled / spilled stock: tap a reason, "all" fills the whole quantity. */
export function WasteDialog({ item, onClose }: { item: WasteItem | null; onClose: () => void }) {
  const { t } = useI18n();
  const waste = useAction(recordWasteAction);
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<string>(WASTE_REASONS[0]);
  useEffect(() => { setQty(''); setReason(WASTE_REASONS[0]); }, [item?.id]);

  return (
    <Dialog open={item !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {item ? (
          <>
            <DialogHeader>
              <DialogTitle>{t.inventory.waste}: {item.name_th}</DialogTitle>
              <DialogDescription>{t.inventory.currentStock}: {formatQty(item.stock_qty)} {item.unit}</DialogDescription>
            </DialogHeader>
            <form className="grid gap-4" onSubmit={async (e) => {
              e.preventDefault();
              if (await waste.run({ ingredient_id: item.id, quantity: qty, reason }) !== null) onClose();
            }}>
              <Field label={`${t.common.quantity} (${item.unit})`}>
                <div className="flex gap-2">
                  <Input name="quantity" type="number" inputMode="decimal" min={0.0001} step="any" required autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />
                  {item.stock_qty > 0 ? <Button type="button" variant="outline" onClick={() => setQty(String(item.stock_qty))}>{t.inventory.all}</Button> : null}
                </div>
              </Field>
              <Field label={t.inventory.wasteReason}>
                <div className="grid gap-2">
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t.inventory.wasteReason}>
                    {WASTE_REASONS.map((r) => (
                      <Button key={r} type="button" size="sm" role="radio" aria-checked={reason === r}
                        variant={reason === r ? 'default' : 'outline'} onClick={() => setReason(r)}>{r}</Button>
                    ))}
                  </div>
                  <Input name="reason" required value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
              </Field>
              <DialogFooter><Button type="submit" disabled={waste.pending}>{t.common.save}</Button></DialogFooter>
            </form>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

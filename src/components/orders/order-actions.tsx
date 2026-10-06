'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Printer, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { cancelOrderAction, refundOrderAction } from '@/server/actions/orders';
import { formatAmount, round2 } from '@/domain/money';
import type { OrderDocument } from '@/domain/schemas/orders';
import { Receipt } from '@/components/pos/receipt';
import type { ReceiptSettings } from '@/components/pos/types';

export function OrderActions({ order, settings, canManage }: { order: OrderDocument; settings: ReceiptSettings; canManage: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [dialog, setDialog] = useState<'cancel' | 'refund' | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const cancel = useAction(cancelOrderAction);
  const refund = useAction(refundOrderAction);
  const refundable = order.status === 'COMPLETED' || order.status === 'PARTIALLY_REFUNDED';
  const ratio = order.subtotal > 0 ? order.total / order.subtotal : 0;
  const estimate = round2(order.items.reduce((s, i) => s + ((qty[i.id] ?? 0) / i.quantity) * i.line_total * ratio, 0));

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => window.print()}><Printer /> {t.common.print}</Button>
        {canManage && order.status === 'COMPLETED' && order.refunded_total === 0 ? (
          <Button variant="destructive" onClick={() => setDialog('cancel')}><Ban /> {t.orders.cancel}</Button>
        ) : null}
        {canManage && refundable ? <Button variant="outline" onClick={() => setDialog('refund')}><Undo2 /> {t.orders.refund}</Button> : null}
      </div>
      <div className="print-area hidden print:block"><Receipt order={order} settings={settings} copy /></div>

      <Dialog open={dialog === 'cancel'} onOpenChange={(o) => setDialog(o ? 'cancel' : null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t.orders.cancel} {order.order_number}</DialogTitle><DialogDescription>{t.orders.cancelHint}</DialogDescription></DialogHeader>
          <form className="grid gap-4" onSubmit={async (e) => {
            e.preventDefault();
            const reason = new FormData(e.currentTarget).get('reason');
            if (await cancel.run({ order_id: order.id, reason })) { setDialog(null); router.refresh(); }
          }}>
            <Field label={t.common.reason}><Input name="reason" required maxLength={300} /></Field>
            <DialogFooter><Button type="submit" variant="destructive" disabled={cancel.pending}>{t.common.confirm}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'refund'} onOpenChange={(o) => setDialog(o ? 'refund' : null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{t.orders.refund} {order.order_number}</DialogTitle></DialogHeader>
          <form className="grid gap-4" onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const items = Object.entries(qty).filter(([, q]) => q > 0).map(([order_item_id, quantity]) => ({ order_item_id, quantity }));
            const ok = await refund.run({ order_id: order.id, items, reason: fd.get('reason'), method: fd.get('method'), restock: fd.get('restock') === 'on' });
            if (ok) { setDialog(null); setQty({}); }
          }}>
            <ul className="grid gap-2">
              {order.items.map((i) => {
                const left = i.quantity - i.refunded_quantity;
                return (
                  <li key={i.id} className="flex items-center justify-between gap-3">
                    <span>{i.product_name} <span className="text-xs text-muted-foreground">({left}/{i.quantity})</span></span>
                    <Input type="number" min={0} max={left} className="w-24" value={qty[i.id] ?? 0} disabled={left === 0} aria-label={t.orders.refundQty}
                      onChange={(e) => setQty((q) => ({ ...q, [i.id]: Math.min(left, Math.max(0, Math.floor(Number(e.target.value) || 0))) }))} />
                  </li>
                );
              })}
            </ul>
            <Field label={t.orders.refundMethod}>
              <NativeSelect name="method" defaultValue={order.payments[0]?.method ?? 'CASH'}>
                {(['CASH', 'QR', 'TRANSFER', 'CARD'] as const).map((m) => <option key={m} value={m}>{t.pos.method[m]}</option>)}
              </NativeSelect>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="restock" className="size-5" /> {t.orders.restock}</label>
            <Field label={t.common.reason}><Input name="reason" required maxLength={300} /></Field>
            <p className="text-right font-semibold">{t.orders.refundAmount}: ฿{formatAmount(estimate)}</p>
            <DialogFooter><Button type="submit" disabled={refund.pending || estimate <= 0}>{t.common.confirm}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

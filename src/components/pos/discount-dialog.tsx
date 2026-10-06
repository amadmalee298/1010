'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/i18n/client';
import type { CartState } from '@/domain/cart';
import type { PromotionRule } from '@/domain/pricing';
import { formatAmount } from '@/domain/money';

export function DiscountDialog({ open, onOpenChange, cart, promotions, maxCashierDiscount, isCashier, onApply }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cart: CartState;
  promotions: PromotionRule[];
  maxCashierDiscount: number;
  isCashier: boolean;
  onApply: (patch: Pick<CartState, 'promotionId' | 'manualDiscount' | 'redeemPoints'>) => void;
}) {
  const { t } = useI18n();
  const [promotionId, setPromotionId] = useState(cart.promotionId ?? '');

  const [manual, setManual] = useState(cart.manualDiscount ? String(cart.manualDiscount) : '');
  const [points, setPoints] = useState(cart.redeemPoints ? String(cart.redeemPoints) : '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent key={String(open)}>
        <DialogHeader><DialogTitle>{t.pos.discounts}</DialogTitle></DialogHeader>
        <Field label={t.pos.promotion}>
          <NativeSelect value={promotionId} onChange={(e) => setPromotionId(e.target.value)}>
            <option value="">{t.pos.none}</option>
            {promotions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.discountType === 'PERCENT' ? `${p.value}%` : `฿${formatAmount(p.value)}`}{p.membersOnly ? ' ⭐' : ''}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t.pos.manualDiscount} hint={isCashier ? `≤ ฿${formatAmount(maxCashierDiscount)}` : undefined}>
          <Input type="number" inputMode="decimal" min={0} step="0.01" value={manual} onChange={(e) => setManual(e.target.value)} />
        </Field>
        {cart.customer ? (
          <Field label={`${t.pos.redeemPoints} (${cart.customer.pointsBalance} ${t.pos.points})`}>
            <Input type="number" inputMode="numeric" min={0} max={cart.customer.pointsBalance} step={1} value={points} onChange={(e) => setPoints(e.target.value)} />
          </Field>
        ) : null}
        <DialogFooter>
          <Button
            onClick={() => {
              onApply({ promotionId: promotionId || null, manualDiscount: Math.max(0, Math.round(Number(manual || 0) * 100) / 100), redeemPoints: Math.max(0, Math.floor(Number(points || 0))) });
              onOpenChange(false);
            }}
          >
            {t.pos.apply}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

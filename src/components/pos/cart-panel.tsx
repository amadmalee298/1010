'use client';
import { useState } from 'react';
import { Minus, Plus, StickyNote, Tag, Trash2, User, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/client';
import { formatAmount } from '@/domain/money';
import type { CartAction, CartState } from '@/domain/cart';
import type { PricingResult } from '@/domain/pricing';

export function CartPanel({ cart, dispatch, pricing, pricingError, onCustomer, onDiscount, onCharge, chargeDisabled, className }: {
  cart: CartState;
  dispatch: (a: CartAction) => void;
  pricing: PricingResult | null;
  pricingError: string | null;
  onCustomer: () => void;
  onDiscount: () => void;
  onCharge: () => void;
  chargeDisabled: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const row = (label: string, value: string, cls = '') => (
    <div className={cn('flex justify-between text-sm', cls)}><span>{label}</span><span className="tabular-nums">{value}</span></div>
  );

  return (
    <div className={cn('flex min-h-0 flex-col bg-card', className)}>
      <div className="grid gap-2 border-b border-border p-3">
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {(['TAKEAWAY', 'DINE_IN', 'DELIVERY'] as const).map((type) => (
            <button key={type} type="button" onClick={() => dispatch({ type: 'set', patch: { orderType: type } })}
              className={cn('flex-1 rounded-lg px-2 py-2 text-sm font-medium', cart.orderType === type ? 'bg-card shadow-sm' : 'text-muted-foreground')}>
              {t.pos.orderType[type]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input placeholder={t.pos.tableLabel} value={cart.tableLabel} maxLength={40} onChange={(e) => dispatch({ type: 'set', patch: { tableLabel: e.target.value } })} />
          {cart.customer ? (
            <span className="flex min-w-0 shrink-0 items-center gap-1 rounded-xl bg-secondary px-3 text-sm">
              <User className="size-4" /><span className="max-w-24 truncate">{cart.customer.name}</span>
              <button type="button" aria-label={t.common.delete} onClick={() => dispatch({ type: 'set', patch: { customer: null, promotionId: null } })}><X className="size-4" /></button>
            </span>
          ) : (
            <Button variant="outline" onClick={onCustomer}><User /> {t.pos.addCustomer}</Button>
          )}
        </div>
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto px-3">
        {cart.lines.length === 0 ? <li className="py-16 text-center text-muted-foreground">🍮<br />{t.pos.emptyCart}</li> : null}
        {cart.lines.map((l) => (
          <li key={l.key} className="grid gap-2 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium leading-snug">{l.name}</p>
                <p className="text-xs text-muted-foreground">฿{formatAmount(l.unitPrice)}</p>
                {l.note && noteFor !== l.key ? <p className="text-xs text-primary-strong">📝 {l.note}</p> : null}
              </div>
              <span className="font-semibold tabular-nums">{formatAmount(l.unitPrice * l.quantity)}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-xl border border-border">
                <button type="button" className="grid size-10 place-items-center" aria-label="-" onClick={() => dispatch({ type: 'setQuantity', key: l.key, quantity: l.quantity - 1 })}><Minus className="size-4" /></button>
                <span className="w-8 text-center font-semibold tabular-nums">{l.quantity}</span>
                <button type="button" className="grid size-10 place-items-center" aria-label="+" onClick={() => dispatch({ type: 'setQuantity', key: l.key, quantity: l.quantity + 1 })}><Plus className="size-4" /></button>
              </div>
              <Button size="icon" variant="ghost" aria-label={t.pos.itemNote} onClick={() => setNoteFor(noteFor === l.key ? null : l.key)}><StickyNote /></Button>
              <Button size="icon" variant="ghost" className="ml-auto text-destructive" aria-label={t.common.delete} onClick={() => dispatch({ type: 'remove', key: l.key })}><Trash2 /></Button>
            </div>
            {noteFor === l.key ? (
              <Input autoFocus defaultValue={l.note} placeholder={t.pos.itemNote} maxLength={200}
                onBlur={(e) => { dispatch({ type: 'setNote', key: l.key, note: e.target.value }); setNoteFor(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            ) : null}
          </li>
        ))}
      </ul>

      <div className="grid gap-2 border-t border-border bg-muted/40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Input placeholder={t.pos.orderNote} value={cart.note} maxLength={500} onChange={(e) => dispatch({ type: 'set', patch: { note: e.target.value } })} />
        {pricing ? (
          <div className="grid gap-0.5">
            {row(t.pos.subtotal, formatAmount(pricing.subtotal))}
            {pricing.promotionDiscount ? row(t.pos.promotion, `-${formatAmount(pricing.promotionDiscount)}`, 'text-success-strong') : null}
            {pricing.manualDiscount ? row(t.pos.discounts, `-${formatAmount(pricing.manualDiscount)}`, 'text-success-strong') : null}
            {pricing.pointsDiscount ? row(`${t.pos.redeemPoints} ${pricing.pointsRedeemed}`, `-${formatAmount(pricing.pointsDiscount)}`, 'text-success-strong') : null}
            {pricing.vatAmount ? row(t.pos.vat, formatAmount(pricing.vatAmount), 'text-muted-foreground') : null}
            {pricing.pointsEarned ? row(t.pos.earn, `${pricing.pointsEarned} ${t.pos.points}`, 'text-muted-foreground') : null}
          </div>
        ) : null}
        {pricingError ? <p className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive">{pricingError}</p> : null}
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onDiscount} disabled={!cart.lines.length}><Tag /> {t.pos.discounts}</Button>
          <Button variant="ghost" onClick={() => dispatch({ type: 'clear' })} disabled={!cart.lines.length}>{t.pos.clear}</Button>
        </div>
        <Button size="lg" className="h-16 justify-between text-lg" onClick={onCharge} disabled={chargeDisabled}>
          <span>{t.pos.charge}</span>
          <span className="tabular-nums">฿{formatAmount(pricing?.total ?? 0)}</span>
        </Button>
      </div>
    </div>
  );
}

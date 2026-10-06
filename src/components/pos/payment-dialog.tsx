'use client';
import { useMemo, useState } from 'react';
import { Banknote, CreditCard, Landmark, Plus, QrCode as QrIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/client';
import { formatAmount, round2 } from '@/domain/money';
import { checkPayments, quickCashOptions, type PaymentLine, type PaymentMethod } from '@/domain/payments';
import { isValidPromptPayId, promptPayPayload } from '@/domain/promptpay';
import { QrCode } from './qr-code';

const METHODS: { method: PaymentMethod; icon: typeof Banknote }[] = [
  { method: 'CASH', icon: Banknote }, { method: 'QR', icon: QrIcon }, { method: 'TRANSFER', icon: Landmark }, { method: 'CARD', icon: CreditCard },
];

interface Draft { id: number; method: PaymentMethod; amount: string; tendered: string; reference: string }

export function PaymentDialog({ open, onOpenChange, total, promptpayId, submitting, onConfirm }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  total: number;
  promptpayId: string;
  submitting: boolean;
  onConfirm: (lines: PaymentLine[]) => void;
}) {
  const { t } = useI18n();
  const [split, setSplit] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([{ id: 0, method: 'CASH', amount: String(total), tendered: '', reference: '' }]);

  const lines: PaymentLine[] = useMemo(() => drafts.map((d) => ({
    method: d.method,
    amount: split ? round2(Number(d.amount || 0)) : total,
    ...(d.method === 'CASH' ? { tendered: d.tendered === '' ? (split ? round2(Number(d.amount || 0)) : total) : round2(Number(d.tendered)) } : {}),
    ...(d.reference ? { reference: d.reference } : {}),
  })), [drafts, split, total]);
  const check = checkPayments(total, total === 0 ? [] : lines);
  const error = check.error === 'UNDERPAID' ? t.pos.underpaid : check.error === 'OVERPAID' ? t.pos.overpaid
    : check.error === 'TENDER_SHORT' ? t.pos.tenderShort : check.error === 'INVALID_AMOUNT' ? t.errors.validation : null;

  const update = (id: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const single = drafts[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>{t.pos.payment}</DialogTitle></DialogHeader>
        <div className="text-center">
          <p className="text-sm text-muted-foreground">{t.pos.amountDue}</p>
          <p className="text-4xl font-bold tabular-nums text-primary-strong">฿{formatAmount(total)}</p>
        </div>

        {!split && single ? (
          <>
            <div className="grid grid-cols-4 gap-2">
              {METHODS.map(({ method, icon: Icon }) => (
                <button key={method} type="button" onClick={() => update(single.id, { method })}
                  className={cn('flex flex-col items-center gap-1 rounded-xl border-2 p-3 text-sm font-medium',
                    single.method === method ? 'border-primary bg-primary/10' : 'border-border')}>
                  <Icon className="size-6" /> {t.pos.method[method]}
                </button>
              ))}
            </div>
            {single.method === 'CASH' ? (
              <div className="grid gap-3">
                <Input type="number" inputMode="decimal" min={0} step="0.01" placeholder={t.pos.tendered} className="h-14 text-2xl"
                  value={single.tendered} onChange={(e) => update(single.id, { tendered: e.target.value })} autoFocus />
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {quickCashOptions(total).map((v) => (
                    <Button key={v} variant="outline" onClick={() => update(single.id, { tendered: String(v) })}>{formatAmount(v)}</Button>
                  ))}
                </div>
                <div className={cn('rounded-xl p-3 text-center text-2xl font-bold tabular-nums', check.error === 'TENDER_SHORT' ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success-strong')}>
                  {t.pos.change} ฿{formatAmount(check.change)}
                </div>
              </div>
            ) : single.method === 'QR' ? (
              <div className="grid justify-items-center gap-2">
                {isValidPromptPayId(promptpayId)
                  ? <QrCode value={promptPayPayload(promptpayId, total)} label={`PromptPay ${formatAmount(total)}`} />
                  : <p className="rounded-xl bg-warning/20 p-3 text-sm">{t.pos.qrNotSet}</p>}
                <p className="text-center text-sm text-muted-foreground">{t.pos.qrHint}</p>
                <Input placeholder={t.pos.reference} value={single.reference} onChange={(e) => update(single.id, { reference: e.target.value })} />
              </div>
            ) : (
              <Input placeholder={t.pos.reference} value={single.reference} onChange={(e) => update(single.id, { reference: e.target.value })} />
            )}
          </>
        ) : (
          <div className="grid gap-2">
            {drafts.map((d) => (
              <div key={d.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <NativeSelect value={d.method} onChange={(e) => update(d.id, { method: e.target.value as PaymentMethod })}>
                  {METHODS.map(({ method }) => <option key={method} value={method}>{t.pos.method[method]}</option>)}
                </NativeSelect>
                <Input type="number" inputMode="decimal" min={0} step="0.01" value={d.amount} onChange={(e) => update(d.id, { amount: e.target.value })} aria-label={t.common.price} />
                <Button size="icon" variant="ghost" disabled={drafts.length === 1} onClick={() => setDrafts((ds) => ds.filter((x) => x.id !== d.id))} aria-label={t.common.delete}><Trash2 /></Button>
                {d.method === 'CASH' ? (
                  <Input className="col-span-2" type="number" inputMode="decimal" placeholder={t.pos.tendered} value={d.tendered} onChange={(e) => update(d.id, { tendered: e.target.value })} />
                ) : null}
              </div>
            ))}
            <Button variant="outline" onClick={() => setDrafts((ds) => [...ds, { id: Math.max(...ds.map((x) => x.id)) + 1, method: 'QR', amount: String(Math.max(0, check.remaining)), tendered: '', reference: '' }])}>
              <Plus /> {t.pos.addPayment}
            </Button>
            <div className="flex justify-between text-sm"><span>{t.pos.paid} ฿{formatAmount(check.paid)}</span><span>{t.pos.remaining} ฿{formatAmount(Math.max(0, check.remaining))}</span></div>
            {check.change > 0 ? <p className="text-center font-semibold text-success-strong">{t.pos.change} ฿{formatAmount(check.change)}</p> : null}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={split} onChange={(e) => {
            setSplit(e.target.checked);
            setDrafts((ds) => ds.slice(0, 1).map((d) => ({ ...d, amount: String(total) })));
          }} />
          {t.pos.splitPayment}
        </label>
        {error && total > 0 ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button size="lg" variant="success" className="w-full" disabled={!check.valid || submitting} onClick={() => onConfirm(total === 0 ? [] : lines)}>
            {submitting ? t.common.loading : t.pos.confirmPayment}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

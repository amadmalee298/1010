'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Ban, Check, CloudUpload, ImagePlus, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { addAttachmentAction, approveBillAction, editSubstituteAction, fileSubstituteAction, rejectBillAction, voidBillAction } from '@/server/actions/bills';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { EXPENSE_CATEGORIES } from '@/domain/schemas/operations';
import { formatAmount, sumBaht } from '@/domain/money';

interface Line { description: string; amount: number | ''; ingredient_id: string; quantity: number | '' | null; onBill?: string; note?: string }
interface IngredientOption { id: string; name: string; unit: string }

export function BillReview({ billId, defaults, ingredients }: {
  billId: string;
  defaults: { bill_date: string; vendor: string; lines: Line[] };
  ingredients: IngredientOption[];
}) {
  const { t } = useI18n();
  const B = t.bills;
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(defaults.lines.length ? defaults.lines : [{ description: '', amount: '', ingredient_id: '', quantity: '' }]);
  const [rejecting, setRejecting] = useState(false);
  const approve = useAction(approveBillAction, { successMessage: B.approvedNote });
  const reject = useAction(rejectBillAction);
  const unitOf = new Map(ingredients.map((i) => [i.id, i.unit]));

  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const num = (v: number | '' | null) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const stock = sumBaht(lines.filter((l) => l.ingredient_id).map((l) => num(l.amount)));
  const expense = sumBaht(lines.filter((l) => !l.ingredient_id).map((l) => num(l.amount)));

  async function submit(form: HTMLFormElement) {
    const fd = new FormData(form);
    const res = await approve.run({
      id: billId,
      bill_date: fd.get('bill_date'), vendor: fd.get('vendor'), category: fd.get('category'),
      payment_method: fd.get('payment_method'), from_drawer: fd.get('from_drawer') === 'on',
      lines: lines.map((l) => ({ description: l.description, amount: l.amount, ingredient_id: l.ingredient_id, quantity: l.quantity ?? '', note: l.note ?? '' })),
    });
    if (res?.driveError) toast.error(`${B.driveFailed}: ${res.driveError}`);
    if (res) router.refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>{B.lines}</CardTitle></CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={B.billDate}><Input type="date" name="bill_date" defaultValue={defaults.bill_date} required /></Field>
            <Field label={B.vendor}><Input name="vendor" defaultValue={defaults.vendor} /></Field>
          </div>

          <div className="grid gap-3">
            {lines.map((l, i) => (
              <div key={i} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_120px_auto]">
                <Field label={`${B.description}${l.onBill ? ` (${B.onBill}: ${l.onBill})` : ''}`}>
                  <Input value={l.description} onChange={(e) => set(i, { description: e.target.value })} required />
                </Field>
                <Field label={`${B.amount} (฿)`}>
                  <Input type="number" inputMode="decimal" min={0.01} step="0.01" value={l.amount}
                    onChange={(e) => set(i, { amount: e.target.value === '' ? '' : Number(e.target.value) })} required />
                </Field>
                <Button type="button" variant="ghost" size="icon" className="self-end" aria-label={t.common.delete}
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1}><Trash2 /></Button>
                <Field label={B.ingredient} className="sm:col-span-2">
                  <NativeSelect value={l.ingredient_id} onChange={(e) => set(i, { ingredient_id: e.target.value })}>
                    <option value="">{B.notStock}</option>
                    {ingredients.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.unit})</option>)}
                  </NativeSelect>
                </Field>
                <Field label={B.note} className="sm:col-span-3">
                  <Input value={l.note ?? ''} onChange={(e) => set(i, { note: e.target.value })} />
                </Field>
                {l.ingredient_id ? (
                  <Field label={`${B.qtyInUnit}: ${unitOf.get(l.ingredient_id) ?? ''}`}>
                    <Input type="number" inputMode="decimal" min={0.0001} step="any" value={l.quantity ?? ''}
                      onChange={(e) => set(i, { quantity: e.target.value === '' ? '' : Number(e.target.value) })} required />
                  </Field>
                ) : null}
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, { description: '', amount: '', ingredient_id: '', quantity: '' }])}>
              <Plus /> {B.addLine}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={B.category}>
              <NativeSelect name="category" defaultValue={EXPENSE_CATEGORIES[0]}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </NativeSelect>
            </Field>
            <Field label={t.expenses.method}>
              <NativeSelect name="payment_method" defaultValue="CASH">
                {(['CASH', 'TRANSFER', 'QR', 'CARD'] as const).map((m) => <option key={m} value={m}>{t.pos.method[m]}</option>)}
              </NativeSelect>
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="from_drawer" className="size-5" /> {t.expenses.fromDrawer}</label>
          </div>

          <dl className="grid grid-cols-3 gap-2 rounded-xl bg-muted p-3 text-sm">
            <div><dt className="text-muted-foreground">{B.stockPart}</dt><dd className="font-semibold tabular-nums">{formatAmount(stock)}</dd></div>
            <div><dt className="text-muted-foreground">{B.expensePart}</dt><dd className="font-semibold tabular-nums">{formatAmount(expense)}</dd></div>
            <div><dt className="text-muted-foreground">{B.total}</dt><dd className="font-semibold tabular-nums">{formatAmount(sumBaht([stock, expense]))}</dd></div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="lg" disabled={approve.pending}><Check /> {B.approve}</Button>
            <Button type="button" size="lg" variant="outline" onClick={() => setRejecting(true)}><X /> {B.reject}</Button>
          </div>
        </form>

        <Dialog open={rejecting} onOpenChange={setRejecting}>
          <DialogContent>
            <DialogHeader><DialogTitle>{B.reject}</DialogTitle></DialogHeader>
            <form className="grid gap-4" onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              if (await reject.run({ id: billId, reason: fd.get('reason') })) setRejecting(false);
            }}>
              <Field label={B.rejectReason}><Input name="reason" required /></Field>
              <DialogFooter><Button type="submit" variant="destructive" disabled={reject.pending}>{t.common.confirm}</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export function FileSubstituteButton({ billId }: { billId: string }) {
  const { t } = useI18n();
  const file = useAction(fileSubstituteAction);
  return (
    <Button variant="outline" disabled={file.pending} onClick={() => void file.run({ id: billId })}>
      <CloudUpload /> {t.bills.fileToDrive}
    </Button>
  );
}

interface DocLine { description: string; note: string; amount: number }

export function EditSubstituteButton({ billId, defaults }: {
  billId: string;
  defaults: { bill_date: string; payer_name: string; approver_name: string; lines: DocLine[] };
}) {
  const { t } = useI18n();
  const B = t.bills;
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<DocLine[]>(defaults.lines);
  const save = useAction(editSubstituteAction);
  return (
    <>
      <Button variant="outline" onClick={() => { setLines(defaults.lines); setOpen(true); }}><Pencil /> {B.edit}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{B.edit}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{B.editHint}</p>
          <form className="grid gap-3" onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const res = await save.run({
              id: billId, bill_date: fd.get('bill_date'), payer_name: fd.get('payer_name'), approver_name: fd.get('approver_name'),
              lines: lines.map((l) => ({ description: l.description, note: l.note })),
            });
            if (res?.driveError) toast.error(`${B.driveFailed}: ${res.driveError}`);
            if (res) setOpen(false);
          }}>
            <Field label={B.billDate}><Input type="date" name="bill_date" defaultValue={defaults.bill_date} required /></Field>
            <Field label={B.payerName}><Input name="payer_name" defaultValue={defaults.payer_name} required /></Field>
            <Field label={B.approverName}><Input name="approver_name" defaultValue={defaults.approver_name} /></Field>
            {lines.map((l, i) => (
              <div key={i} className="grid gap-2 rounded-xl border border-border p-2">
                <Field label={`${B.description} · ${formatAmount(l.amount)}`}>
                  <Input value={l.description} required onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                </Field>
                <Field label={B.note}>
                  <Input value={l.note} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
                </Field>
              </div>
            ))}
            <DialogFooter><Button type="submit" disabled={save.pending}>{t.common.save}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function VoidBillButton({ billId }: { billId: string }) {
  const { t } = useI18n();
  const B = t.bills;
  const [open, setOpen] = useState(false);
  const voidIt = useAction(voidBillAction);
  return (
    <>
      <Button variant="outline" className="text-destructive" onClick={() => setOpen(true)}><Ban /> {B.voidBill}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{B.voidBill}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{B.voidHint}</p>
          <form className="grid gap-3" onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            if (await voidIt.run({ id: billId, reason: fd.get('reason') })) setOpen(false);
          }}>
            <Field label={B.voidReason}><Input name="reason" required /></Field>
            <DialogFooter><Button type="submit" variant="destructive" disabled={voidIt.pending}>{t.common.confirm}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const MAX_BYTES = 10 * 1024 * 1024;

/** Uploads straight to Storage from the browser (managers may write bill files), then registers it. */
export function AttachmentUploader({ billId }: { billId: string }) {
  const { t } = useI18n();
  const B = t.bills;
  const [kind, setKind] = useState<'SLIP' | 'EVIDENCE' | 'OTHER'>('SLIP');
  const [busy, setBusy] = useState(false);
  const add = useAction(addAttachmentAction);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) { toast.error(`${file.name}: > 10MB`); continue; }
        const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = `bills/${new Date().toISOString().slice(0, 7)}/${billId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error } = await getSupabaseBrowserClient().storage.from('expense-receipts').upload(path, file, { contentType: file.type || 'image/jpeg' });
        if (error) { toast.error(error.message); continue; }
        const res = await add.run({ bill_id: billId, kind, path });
        if (res?.driveError) toast.error(`${B.driveFailed}: ${res.driveError}`);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-auto" aria-label={B.attachments}>
        <option value="SLIP">{B.slip}</option>
        <option value="EVIDENCE">{B.evidence}</option>
        <option value="OTHER">{B.other}</option>
      </NativeSelect>
      <label className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-border px-4 ${busy ? 'opacity-50' : ''}`}>
        <ImagePlus className="size-5" /> {busy ? B.uploading : B.addAttachment}
        <input type="file" accept="image/*,application/pdf" multiple className="sr-only" disabled={busy} onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} />
      </label>
    </div>
  );
}

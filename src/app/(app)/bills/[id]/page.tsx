import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink, Printer } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { billPhotoUrl, getBill } from '@/server/repositories/bills';
import { listIngredients } from '@/server/repositories/ingredients';
import { driveConfigured } from '@/server/integrations/google-drive';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { BillReview, FileSubstituteButton } from '@/components/bills/bill-review';
import { MANAGEMENT } from '@/domain/permissions';
import { formatAmount } from '@/domain/money';
import { bangkokDate, formatDateTime } from '@/domain/datetime';
import { billExtractionSchema, type BillExtraction } from '@/domain/bills';

type ApprovedLine = { description: string; amount: number; ingredient_id?: string; quantity?: number };

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  await requireEmployee(MANAGEMENT);
  const { id } = await params;
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const bill = await getBill(db, id);
  if (!bill) notFound();
  const [photo, ingredients] = await Promise.all([billPhotoUrl(db, bill.photo_path), listIngredients(db, { activeOnly: true, type: 'RAW' })]);
  const parsed = billExtractionSchema.safeParse(bill.extraction);
  const extraction: BillExtraction | null = parsed.success ? parsed.data : null;
  const B = t.bills;
  const approved = (Array.isArray(bill.approved_lines) ? bill.approved_lines : []) as unknown as ApprovedLine[];
  const nameOf = new Map(ingredients.map((i) => [i.id, `${i.name_th} (${i.unit})`]));

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={`${B.title} ${bill.submission_number}`}
        description={`${B.submittedBy}: ${bill.submitter_name} · ${formatDateTime(bill.created_at)}`}
        actions={<Button asChild variant="outline"><Link href="/bills">{t.common.back}</Link></Button>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {bill.has_receipt ? <Badge variant="info">{B.hasReceipt}</Badge> : <Badge variant="warning">{B.noReceipt}</Badge>}
        <Badge variant={bill.status === 'APPROVED' ? 'success' : bill.status === 'REJECTED' ? 'destructive' : 'secondary'}>
          {bill.status === 'APPROVED' ? B.approved : bill.status === 'REJECTED' ? B.rejected : B.pending}
        </Badge>
        {bill.review_note ? <Badge variant="destructive">{bill.review_note}</Badge> : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="grid content-start gap-4">
          {photo ? (
            <Card><CardHeader><CardTitle>{B.photo}</CardTitle></CardHeader>
              <CardContent>
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                <a href={photo} target="_blank" rel="noreferrer"><img src={photo} alt={B.photo} className="w-full rounded-xl border border-border" /></a>
                {bill.photo_url ? <a href={bill.photo_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-primary-strong"><ExternalLink className="size-4" /> {B.openDrive}</a> : null}
              </CardContent>
            </Card>
          ) : null}
          {bill.message_text ? <Card><CardHeader><CardTitle>{B.message}</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap">{bill.message_text}</p></CardContent></Card> : null}
          {bill.extraction_error ? <p className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{B.aiFailed}: {bill.extraction_error}</p> : null}
          {extraction && !extraction.is_bill ? <p className="rounded-xl bg-warning/15 p-3 text-sm">{B.notABill}</p> : null}
          {extraction?.note ? <p className="rounded-xl bg-info/10 p-3 text-sm">{B.aiNote}: {extraction.note}</p> : null}
        </div>

        {bill.status === 'PENDING' ? (
          <BillReview
            billId={bill.id}
            defaults={{
              bill_date: bill.bill_date ?? extraction?.bill_date ?? bangkokDate(bill.created_at),
              vendor: bill.vendor ?? extraction?.vendor ?? '',
              lines: (extraction?.lines ?? []).map((l) => ({
                description: l.description, amount: l.amount, ingredient_id: l.ingredient_id ?? '',
                quantity: l.ingredient_quantity ?? (l.ingredient_id ? l.quantity : null),
                onBill: [l.quantity, l.unit].filter((v) => v !== null && v !== '').join(' '),
              })),
            }}
            ingredients={ingredients.map((i) => ({ id: i.id, name: i.name_th, unit: i.unit }))}
          />
        ) : (
          <Card>
            <CardHeader><CardTitle>{B.lines}</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <Table>
                <THead><TR><TH>{B.description}</TH><TH>{B.ingredient}</TH><TH className="text-right">{B.amount}</TH></TR></THead>
                <TBody>
                  {approved.map((l, i) => (
                    <TR key={i}><TD>{l.description}</TD><TD>{l.ingredient_id ? `${nameOf.get(l.ingredient_id) ?? ''} × ${l.quantity ?? ''}` : B.expensePart}</TD><TD className="text-right tabular-nums">{formatAmount(l.amount)}</TD></TR>
                  ))}
                  <TR><TD colSpan={2} className="text-right font-semibold">{B.total}</TD><TD className="text-right font-semibold tabular-nums">{formatAmount(bill.total ?? 0)}</TD></TR>
                </TBody>
              </Table>
              {bill.substitute_number ? (
                <div className="grid gap-2 rounded-xl border border-border p-3">
                  <p className="font-medium">{B.substitute} {bill.substitute_number}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline"><a href={`/api/bills/${bill.id}/substitute`} target="_blank" rel="noreferrer"><Printer /> {B.printSubstitute}</a></Button>
                    {bill.substitute_url
                      ? <Button asChild variant="outline"><a href={bill.substitute_url} target="_blank" rel="noreferrer"><ExternalLink /> {B.openDrive}</a></Button>
                      : driveConfigured() ? <FileSubstituteButton billId={bill.id} /> : <p className="text-sm text-muted-foreground">{B.driveNotConfigured}</p>}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

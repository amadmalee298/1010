import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import type { BillSubmissionRow } from '@/lib/database.types';
import { substituteReceiptHtml, type SubstituteReceipt } from '@/domain/bills';
import { bangkokDate } from '@/domain/datetime';
import { getSettings } from '@/server/repositories/settings';
import { driveConfigured, monthFolder, uploadToDrive } from '@/server/integrations/google-drive';

type ApprovedLine = { description?: unknown; amount?: unknown };

/** The substitute receipt for an approved bill that had no receipt (null otherwise). */
export async function buildSubstituteReceipt(db: SupabaseServerClient, bill: BillSubmissionRow): Promise<SubstituteReceipt | null> {
  if (bill.status !== 'APPROVED' || !bill.substitute_number) return null;
  const s = await getSettings(db);
  const note = bill.source === 'TELEGRAM' ? `จาก Telegram: ${bill.submitter_name}` : '';
  const lines = (Array.isArray(bill.approved_lines) ? (bill.approved_lines as ApprovedLine[]) : [])
    .map((l) => ({ description: String(l.description ?? ''), amount: Number(l.amount ?? 0), note }));
  return {
    number: bill.substitute_number,
    date: bill.bill_date ?? bangkokDate(bill.created_at),
    company: { name: s.company_name || s.shop_name, taxId: s.tax_id, address: s.shop_address, phone: s.shop_phone },
    payer: bill.submitter_name,
    lines,
  };
}

/** Converts the substitute receipt to PDF in Google Drive and stores the link. */
export async function fileSubstituteReceipt(db: SupabaseServerClient, bill: BillSubmissionRow): Promise<string | null> {
  const doc = await buildSubstituteReceipt(db, bill);
  if (!doc || !driveConfigured()) return null;
  const url = await uploadToDrive([...monthFolder(doc.date), 'ใบรับรองแทนใบเสร็จ'], {
    kind: 'html-to-pdf', name: `${doc.number.replace('/', '-')} ${doc.payer}`, html: substituteReceiptHtml(doc),
  });
  const { error } = await db.rpc('set_bill_links', { p_id: bill.id, p_photo_url: null, p_substitute_url: url });
  if (error) throw new Error(error.message);
  return url;
}

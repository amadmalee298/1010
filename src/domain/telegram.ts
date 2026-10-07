import { formatTHB } from './money';

/** Pure helpers for the Telegram bot replies. */

const num = (v: unknown) => Number(v ?? 0);
const pct = (v: unknown) => (v === null || v === undefined ? '–' : `${(num(v) * 100).toFixed(1)}%`);

/** "/today@my_bot extra" → { name: 'today', args: 'extra' } */
export function parseCommand(text: string): { name: string; args: string } | null {
  const m = text.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  return m ? { name: (m[1] ?? '').toLowerCase(), args: (m[2] ?? '').trim() } : null;
}

export function summaryText(title: string, s: Record<string, unknown>, appOrigin: string): string {
  const pending = num(s.pending_bills);
  return [
    `📊 ${title}`,
    `ยอดขายสุทธิ (ไม่รวม VAT): ${formatTHB(num(s.net_sales))}`,
    `ออเดอร์: ${num(s.orders)} บิล${num(s.cancelled) ? ` (ยกเลิก ${num(s.cancelled)})` : ''}`,
    `ต้นทุนขาย: ${formatTHB(num(s.cogs))}`,
    `กำไรขั้นต้น: ${formatTHB(num(s.gross_profit))} (${pct(s.gross_margin)})`,
    `ค่าใช้จ่าย: ${formatTHB(num(s.expenses_total))}`,
    num(s.waste) + num(s.shrinkage) ? `ของเสีย/สูญหาย: ${formatTHB(num(s.waste) + num(s.shrinkage))}` : null,
    `กำไรสุทธิ: ${formatTHB(num(s.net_profit))} (${pct(s.net_margin)})`,
    `ซื้อวัตถุดิบเข้าสต็อก: ${formatTHB(num(s.purchases))}`,
    pending ? `\n🧾 บิลรออนุมัติ ${pending} รายการ\n${appOrigin}/bills` : null,
  ].filter((l) => l !== null).join('\n');
}

// -----------------------------------------------------------------------------
// Bill card: the bot's summary of one bill, with buttons
// -----------------------------------------------------------------------------

export type CardKind = 'SLIP' | 'EVIDENCE' | 'OTHER';
export interface BillCard {
  id: string;
  submission_number: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  voided: boolean;
  void_reason: string | null;
  review_note: string | null;
  total: number | null;
  descriptions: string[];
  message_text: string | null;
  vendor: string | null;
  bill_date: string;
  has_receipt: boolean;
  substitute_number: string | null;
  payer_name: string | null;
  payer_signed: boolean;
  approver_signed: boolean;
  paid_method: 'CASH' | 'QR' | 'TRANSFER' | 'CARD' | null;
  paid_from_drawer: boolean | null;
  category: string | null;
  attachments: Record<CardKind, number>;
  company: string | null;
  submitter_chat_id: number | null;
}

const METHOD: Record<NonNullable<BillCard['paid_method']>, string> = { CASH: 'เงินสด', QR: 'QR', TRANSFER: 'โอน', CARD: 'บัตร' };
export const KIND_LABEL: Record<CardKind, string> = { SLIP: 'สลิปโอน', EVIDENCE: 'หลักฐานการซื้อ', OTHER: 'อื่นๆ' };
const amount = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const thaiDate = (iso: string) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' })
  .format(new Date(`${iso.slice(0, 10)}T12:00:00+07:00`));

export function billCardText(c: BillCard): string {
  const cancelled = c.voided || c.status === 'REJECTED';
  const head = c.voided ? '🚫 ยกเลิกรายการแล้ว'
    : c.status === 'REJECTED' ? '❌ ยกเลิก / ไม่อนุมัติ'
    : c.status === 'APPROVED' ? '✅ บันทึกเรียบร้อย'
    : '📥 รับรายการแล้ว · รออนุมัติ';
  const paid = c.voided ? '🚫 ยกเลิกแล้ว'
    : c.status === 'REJECTED' ? '❌ ไม่ได้จ่าย'
    : c.status === 'APPROVED'
      ? `✅ จ่ายแล้ว${c.paid_method ? ` (${c.paid_from_drawer ? 'เงินสดจากลิ้นชัก' : METHOD[c.paid_method]})` : ''}`
      : '⏳ รอผู้จัดการอนุมัติ';
  const document = c.substitute_number ? `ใบรับรองแทนใบเสร็จ ${c.substitute_number}`
    : c.has_receipt ? 'บิล/ใบเสร็จ (รูป)'
    : cancelled ? 'ใบรับรองแทนใบเสร็จ (ไม่ได้ออก)' : 'ใบรับรองแทนใบเสร็จ (ออกเลขหลังอนุมัติ)';
  const evidence = [
    c.has_receipt ? 'รูปบิล 1' : null,
    ...(['SLIP', 'EVIDENCE', 'OTHER'] as const).filter((k) => c.attachments[k] > 0).map((k) => `${KIND_LABEL[k]} ${c.attachments[k]}`),
  ].filter(Boolean).join(' · ') || 'ยังไม่มี';
  const description = c.descriptions.length ? c.descriptions.join(', ') : (c.vendor ?? c.message_text ?? '—');
  const sign = (ok: boolean) => (ok ? '✅' : '⏳');
  return [
    `${head}`,
    `🔖 ${c.submission_number}`,
    '━━━━━━━━━━━━━━',
    c.total !== null ? `📉 รายจ่าย  -${amount(c.total)} บาท` : '📉 รายจ่าย  (รอกรอกยอด)',
    `📝 ${description}`,
    c.vendor && c.descriptions.length ? `🏪 ร้าน: ${c.vendor}` : null,
    '',
    `📅 วันที่: ${thaiDate(c.bill_date)}`,
    `💳 สถานะการจ่าย: ${paid}`,
    c.category ? `🗂 หมวดหมู่: ${c.category}` : null,
    `📄 เอกสาร: ${document}`,
    c.payer_name ? `👤 ผู้เบิกจ่าย: ${c.payer_name}` : null,
    `✍️ ลายเซ็น: ผู้เบิก ${sign(c.payer_signed)} · ผู้อนุมัติ ${sign(c.approver_signed)}`,
    `📎 หลักฐาน: ${evidence}`,
    c.company ? `🏢 ธุรกิจ: ${c.company}` : null,
    c.voided && c.void_reason ? `\nเหตุผลที่ยกเลิก: ${c.void_reason}` : null,
    !c.voided && c.status === 'REJECTED' && c.review_note ? `\nเหตุผล: ${c.review_note}` : null,
  ].filter((l) => l !== null).join('\n');
}

export type InlineButton = { text: string; callback_data: string } | { text: string; url: string };

/** Buttons under a card: attach while the bill is alive, cancel while it still waits for approval. */
export function billCardButtons(c: BillCard, appUrl?: string | null): InlineButton[][] {
  const rows: InlineButton[][] = [];
  const n = c.submission_number;
  if (!c.voided && c.status !== 'REJECTED') {
    rows.push([{ text: '📎 แนบสลิปโอน', callback_data: `att:SLIP:${n}` }, { text: '🧾 แนบหลักฐานการซื้อ', callback_data: `att:EVIDENCE:${n}` }]);
  }
  if (!c.voided && c.status === 'PENDING') rows.push([{ text: '❌ ยกเลิกรายการ', callback_data: `cancel:${n}` }]);
  if (appUrl && /^https:\/\//.test(appUrl)) rows.push([{ text: '🔗 เปิดในแอป', url: appUrl }]);
  return rows;
}

export type BillCallback =
  | { action: 'attach'; kind: CardKind; number: string }
  | { action: 'cancel' | 'confirm_cancel' | 'keep'; number: string };

export function parseCallback(data: string | undefined): BillCallback | null {
  const att = data?.match(/^att:(SLIP|EVIDENCE|OTHER):(BL\d{6}-\d{4})$/);
  if (att) return { action: 'attach', kind: att[1] as CardKind, number: att[2] ?? '' };
  const other = data?.match(/^(cancel|cancel!|keep):(BL\d{6}-\d{4})$/);
  if (!other) return null;
  const action = other[1] === 'cancel!' ? 'confirm_cancel' : other[1] === 'keep' ? 'keep' : 'cancel';
  return { action, number: other[2] ?? '' };
}

/** Kind of a photo sent as a reply, from its caption ("สลิป" → slip). */
export const kindFromCaption = (caption: string): CardKind => (/สลิป|slip|โอน/i.test(caption) ? 'SLIP' : 'EVIDENCE');

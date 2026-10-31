import { formatTHB } from './money';
import { billAmountMissing } from './bills';

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
  /** The bill photo exists and is a bank transfer slip (shown as the slip, not as a receipt). */
  has_photo?: boolean;
  is_slip?: boolean;
}

const METHOD: Record<NonNullable<BillCard['paid_method']>, string> = { CASH: 'เงินสด', QR: 'QR', TRANSFER: 'โอน', CARD: 'บัตร' };
export const KIND_LABEL: Record<CardKind, string> = { SLIP: 'สลิปโอน', EVIDENCE: 'หลักฐานการซื้อ', OTHER: 'อื่นๆ' };
const amount = (n: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const thaiDate = (iso: string) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' })
  .format(new Date(`${iso.slice(0, 10)}T12:00:00+07:00`));

/** "รายจ่าย -1,060.00 บาท". A pending bill without an amount asks for one; a closed bill never does. */
function expenseLine(c: BillCard): string {
  if (billAmountMissing(c.total)) return c.status === 'PENDING' && !c.voided ? '📉 รายจ่าย  (รอกรอกยอด)' : '📉 รายจ่าย  —';
  return `📉 รายจ่าย  -${amount(Number(c.total))} บาท`;
}

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
    c.has_receipt ? 'รูปบิล 1' : c.is_slip && c.has_photo ? `${KIND_LABEL.SLIP} 1` : null,
    ...(['SLIP', 'EVIDENCE', 'OTHER'] as const).filter((k) => c.attachments[k] > 0).map((k) => `${KIND_LABEL[k]} ${c.attachments[k]}`),
  ].filter(Boolean).join(' · ') || 'ยังไม่มี';
  const description = c.descriptions.length ? c.descriptions.join(', ') : (c.vendor ?? c.message_text ?? '—');
  const sign = (ok: boolean) => (ok ? '✅' : '⏳');
  return [
    `${head}`,
    `🔖 ${c.submission_number}`,
    '━━━━━━━━━━━━━━',
    expenseLine(c),
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

// -----------------------------------------------------------------------------
// Dates typed at the start of a message, and income
// -----------------------------------------------------------------------------

/**
 * "12/10/69 …" → { date: '2026-10-12', rest: '…' }. Two-digit years ≥ 50 and four-digit years > 2400
 * are Buddhist-era (69 → 2569 → 2026); others are Christian-era.
 */
export function parseLeadingDate(text: string): { date: string | null; rest: string } {
  const m = text.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?=\s|$)\s*/);
  if (!m) return { date: null, rest: text.trim() };
  const day = Number(m[1]), month = Number(m[2]);
  let year = Number(m[3]);
  if ((m[3] ?? '').length === 2) year = year >= 50 ? 2500 + year - 543 : 2000 + year;
  else if (year > 2400) year -= 543;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return { date: null, rest: text.trim() };
  return { date: d.toISOString().slice(0, 10), rest: text.trim().slice(m[0].length).trim() };
}

const INCOME = /^\+|รายได้|รายรับ|ยอดขาย|ขายได้|รับเงิน/;

/** Income typed to the bot: "+2319", "รายได้ร้าน 2,319 บาท", "ยอดขายวันนี้ 1500". Never an expense line ("จ่าย…"). */
export function parseIncomeText(text: string): { date: string | null; amount: number; memo: string } | null {
  const { date, rest } = parseLeadingDate(text);
  if (!INCOME.test(rest) || /^(จ่าย|ค่า)/.test(rest)) return null;
  const m = rest.match(/^\+?\s*(.*?)[\s:=-]*\+?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|฿|thb)?\.?$/i);
  if (!m) return null;
  const amount = Number((m[2] ?? '').replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { date, amount: Math.round(amount * 100) / 100, memo: (m[1] ?? '').trim() || 'รายรับ' };
}

export function incomeDraftText(i: { date: string; amount: number; memo: string; company: string | null }): string {
  return [
    '💰 รายรับ · เลือกช่องทางรับเงิน',
    '━━━━━━━━━━━━━━',
    `📈 รายรับ  +${amount(i.amount)} บาท`,
    `📝 ${i.memo}`,
    '',
    `📅 วันที่: ${thaiDate(i.date)}`,
    '🗂 หมวดหมู่: รายได้จากการขาย',
    i.company ? `🏢 ธุรกิจ: ${i.company}` : null,
    '',
    'รับเป็นเงินสดหรือโอน/QR?',
  ].filter((l) => l !== null).join('\n');
}

export function incomePostedText(i: { date: string; amount: number; memo: string; company: string | null; entry: string; bank: boolean }): string {
  return [
    '✅ บันทึกรายรับเรียบร้อย',
    `🔖 ${i.entry}`,
    '━━━━━━━━━━━━━━',
    `📈 รายรับ  +${amount(i.amount)} บาท`,
    `📝 ${i.memo}`,
    '',
    `📅 วันที่: ${thaiDate(i.date)}`,
    `💳 รับเป็น: ${i.bank ? 'โอน / QR (บัญชีธนาคาร)' : 'เงินสด'}`,
    '🗂 หมวดหมู่: รายได้จากการขาย',
    i.company ? `🏢 ธุรกิจ: ${i.company}` : null,
  ].filter((l) => l !== null).join('\n');
}

export type IncomeCallback =
  | { action: 'income_post'; bank: boolean; draft: string }
  | { action: 'income_discard'; draft: string }
  | { action: 'income_reverse'; draft: string };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export function parseIncomeCallback(data: string | undefined): IncomeCallback | null {
  const post = data?.match(new RegExp(`^inc:(C|B):(${UUID})$`));
  if (post) return { action: 'income_post', bank: post[1] === 'B', draft: post[2] ?? '' };
  const other = data?.match(new RegExp(`^(incx|incr):(${UUID})$`));
  if (!other) return null;
  return other[1] === 'incx' ? { action: 'income_discard', draft: other[2] ?? '' } : { action: 'income_reverse', draft: other[2] ?? '' };
}

/** Buttons offered when a new slip may pay an existing pending bill. */
export type SlipCallback = { action: 'slip_attach'; slip: string; target: string } | { action: 'slip_keep'; slip: string };

export function parseSlipCallback(data: string | undefined): SlipCallback | null {
  const attach = data?.match(/^slip:(BL\d{6}-\d{4}):(BL\d{6}-\d{4})$/);
  if (attach) return { action: 'slip_attach', slip: attach[1] ?? '', target: attach[2] ?? '' };
  const keep = data?.match(/^slipkeep:(BL\d{6}-\d{4})$/);
  return keep ? { action: 'slip_keep', slip: keep[1] ?? '' } : null;
}

/**
 * Whether a pending bill could be the purchase a transfer slip pays: same amount, not itself a slip,
 * no slip attached yet, the slip's recipient matching the bill's shop when both are known, and the
 * transfer within 7 days of the bill date when both are known. The owner still confirms with a button.
 */
export function slipMayPay(
  slip: { total: number; vendor: string | null; date: string | null },
  bill: { total: number | null; vendor: string | null; bill_date: string | null; is_slip: boolean; has_slip: boolean },
): boolean {
  if (bill.is_slip || bill.has_slip || bill.total == null || Math.round(Number(bill.total) * 100) !== Math.round(slip.total * 100)) return false;
  const norm = (v: string) => v.toLowerCase().replace(/[\s.()]|นาย|นางสาว|นาง|น\.ส|บริษัท|จำกัด|ร้าน|หจก/g, '');
  if (slip.vendor && bill.vendor) {
    const a = norm(slip.vendor), b = norm(bill.vendor);
    if (a && b && !a.includes(b) && !b.includes(a)) return false;
  }
  if (slip.date && bill.bill_date) {
    const days = Math.abs(Date.parse(slip.date) - Date.parse(bill.bill_date)) / 86_400_000;
    if (!(days <= 7)) return false;
  }
  return true;
}

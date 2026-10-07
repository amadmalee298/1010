import { z } from 'zod';
import { formatAmount, round2, toSatang } from './money';

/**
 * Bill inbox domain: Thai baht text, the shape the AI bill reader returns,
 * a fallback parser for text-only expenses, and the substitute receipt
 * (ใบรับรองแทนใบเสร็จรับเงิน) document.
 */

// -----------------------------------------------------------------------------
// Baht text: 1060 → "หนึ่งพันหกสิบบาทถ้วน"
// -----------------------------------------------------------------------------
const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

/** Reads a non-negative integer below one million; `leading` is true when higher digits precede it. */
function readGroup(n: number, leading: boolean): string {
  const digits = String(n).split('').map(Number).reverse();
  let out = '';
  for (let place = digits.length - 1; place >= 0; place--) {
    const d = digits[place] ?? 0;
    if (d === 0) continue;
    if (place === 0) out += d === 1 && (leading || n > 9) ? 'เอ็ด' : (DIGITS[d] ?? '');
    else if (place === 1) out += (d === 1 ? '' : d === 2 ? 'ยี่' : (DIGITS[d] ?? '')) + 'สิบ';
    else out += (DIGITS[d] ?? '') + (PLACES[place] ?? '');
  }
  return out;
}

function readInteger(n: number): string {
  if (n === 0) return 'ศูนย์';
  const groups: number[] = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 1_000_000)) groups.push(rest % 1_000_000);
  let out = '';
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i] ?? 0;
    if (g > 0) out += readGroup(g, i < groups.length - 1);
    if (i > 0) out += 'ล้าน';
  }
  return out;
}

export function bahtText(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError('amount must be a non-negative number');
  const satang = toSatang(round2(amount));
  const baht = Math.floor(satang / 100);
  const st = satang % 100;
  if (st === 0) return `${readInteger(baht)}บาทถ้วน`;
  return `${baht > 0 ? `${readInteger(baht)}บาท` : ''}${readGroup(st, false)}สตางค์`;
}

// -----------------------------------------------------------------------------
// AI bill reading
// -----------------------------------------------------------------------------
export const billLineSchema = z.object({
  description: z.string().describe('Item as written on the bill, in Thai if the bill is Thai'),
  quantity: z.number().nullable().describe('Quantity on the bill, null if not shown'),
  unit: z.string().nullable().describe('Unit on the bill (e.g. กก., ฟอง, แพ็ค), null if not shown'),
  amount: z.number().describe('Line total in THB'),
  ingredient_id: z.string().nullable().describe('id of the matching shop ingredient from the provided list, or null'),
  ingredient_quantity: z.number().nullable()
    .describe('Quantity converted to that ingredient\'s unit (e.g. 2 กก. → 2000 when the unit is กรัม), or null'),
});
export const billExtractionSchema = z.object({
  is_bill: z.boolean().describe('false when the image is not a receipt, bill or invoice'),
  vendor: z.string().nullable(),
  bill_date: z.string().nullable().describe('Date on the bill as YYYY-MM-DD (Gregorian; convert Buddhist-era years by subtracting 543)'),
  lines: z.array(billLineSchema),
  total: z.number().nullable().describe('Grand total in THB'),
  note: z.string().nullable().describe('Anything the manager should double-check, in Thai'),
});
export type BillLine = z.infer<typeof billLineSchema>;
export type BillExtraction = z.infer<typeof billExtractionSchema>;

/** "ค่ากุ้งสด ปลาหมึก 1,060" → one line. Used for text messages when the AI is unavailable. */
export function parseExpenseText(text: string): BillExtraction | null {
  const m = text.trim().match(/^(.*?)[\s:=-]*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:บาท|฿|thb)?\.?$/i);
  if (!m) return null;
  const description = (m[1] ?? '').trim();
  const amount = Number((m[2] ?? '').replace(/,/g, ''));
  if (!description || !Number.isFinite(amount) || amount <= 0) return null;
  return {
    is_bill: true, vendor: null, bill_date: null, total: round2(amount), note: null,
    lines: [{ description, quantity: null, unit: null, amount: round2(amount), ingredient_id: null, ingredient_quantity: null }],
  };
}

// -----------------------------------------------------------------------------
// Substitute receipt (ใบรับรองแทนใบเสร็จรับเงิน)
// -----------------------------------------------------------------------------
export interface SubstituteReceipt {
  number: string;
  /** YYYY-MM-DD */
  date: string;
  company: { name: string; taxId: string; address: string; phone: string };
  payer: string;
  lines: { description: string; amount: number; note: string }[];
  /** PNG data URLs captured at approval; omitted → blank line to sign by hand */
  payerSignature?: string | null;
  approverSignature?: string | null;
  approverName?: string | null;
  /** Voided documents keep their number and print with a cancellation stamp. */
  voided?: boolean;
}

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
  'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function thaiDates(iso: string): { long: string; short: string } {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const be = y + 543;
  return {
    long: `${d} ${THAI_MONTHS[m - 1] ?? ''} ${be}`,
    short: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${be}`,
  };
}

/** "0105562089123" → "0-1055-62089-12-3" */
export function formatTaxId(taxId: string): string {
  const d = taxId.replace(/\D/g, '');
  return d.length === 13 ? `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}` : taxId;
}

const SIGNATURE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
/** Signature image above the line, or an empty box of the same height. */
const sig = (dataUrl: string | null | undefined) =>
  dataUrl && SIGNATURE.test(dataUrl) ? `<img class="sig" src="${dataUrl}" alt="">` : '<div class="sig"></div>';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** Standalone A4 HTML (also converted to PDF by the Google Drive script). */
export function substituteReceiptHtml(r: SubstituteReceipt): string {
  const total = round2(r.lines.reduce((s, l) => s + l.amount, 0));
  const { long, short } = thaiDates(r.date);
  const rows = r.lines.map((l, i) => `<tr><td class="c">${i + 1}</td><td>${esc(l.description)}</td><td class="r">${formatAmount(l.amount)}</td><td class="s">${esc(l.note)}</td></tr>`).join('');
  const company = esc(r.company.name);
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ใบรับรองแทนใบเสร็จรับเงิน ${esc(r.number)}</title>
<style>
@page{size:A4;margin:18mm}body{font-family:'Sarabun','TH Sarabun New','Noto Sans Thai',sans-serif;font-size:15px;color:#000;line-height:1.6}
h1{text-align:center;font-size:20px;margin:0 0 4px}.no{text-align:right;font-size:12px}.date{text-align:right}
table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #000;padding:4px 6px;vertical-align:top}
th{font-size:13px}.c{text-align:center;width:48px}.r{text-align:right;width:120px}.s{font-size:12px;width:130px}
.void{position:fixed;top:38%;left:0;right:0;text-align:center;font-size:96px;font-weight:700;color:rgba(200,0,0,.25);transform:rotate(-20deg);pointer-events:none}
.sig{display:block;height:56px;max-width:220px;margin:0 auto;object-fit:contain}
.sign{display:flex;justify-content:space-around;margin-top:24px;text-align:center;font-size:13px}.line{border-top:1px solid #000;width:220px;margin:0 auto 4px}
</style></head><body>
${r.voided ? '<div class="void">ยกเลิก</div>' : ''}<h1>ใบรับรองแทน ใบเสร็จรับเงิน</h1><div class="no">เลขที่ ${esc(r.number)}</div>
<p>ผู้ซื้อ/ผู้รับบริการ: ${company}<br>เลขประจำตัวผู้เสียภาษี: ${esc(formatTaxId(r.company.taxId))}<br>ที่อยู่: ${esc(r.company.address)}<br>โทร: ${esc(r.company.phone)}</p>
<div class="date">วันที่: ${long}</div>
<table><thead><tr><th>ลำดับ</th><th>รายละเอียด</th><th>จำนวนเงิน (บาท)</th><th>หมายเหตุ</th></tr></thead>
<tbody>${rows}<tr><td colspan="2" class="r"><b>รวมทั้งสิ้น</b></td><td class="r"><b>${formatAmount(total)}</b></td><td></td></tr></tbody></table>
<p>รวมทั้งสิ้น (ตัวอักษร) ${bahtText(total)}</p>
<p>ข้าพเจ้า ${esc(r.payer)} (ผู้เบิกจ่าย)<br>ขอรับรองว่า รายจ่ายข้างต้นนี้ไม่อาจเรียกเก็บใบเสร็จรับเงินจากผู้รับได้ และข้าพเจ้าได้จ่ายไปในงานของ ${company} โดยแท้ ตั้งแต่วันที่ ${short} ถึงวันที่ ${short}</p>
<div class="sign"><div>${sig(r.payerSignature)}<div class="line"></div>(${esc(r.payer)})<br>ผู้เบิกจ่าย</div><div>${sig(r.approverSignature)}<div class="line"></div>(${r.approverName ? esc(r.approverName) : '..............................'})<br>ผู้อนุมัติ</div></div>
</body></html>`;
}

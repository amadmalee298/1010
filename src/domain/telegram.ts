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

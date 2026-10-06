// ใบเสร็จ (80mm) + ใบสั่งครัว
import { state, esc, money, LABELS, printHtml, thDate } from './core.js';

export function receiptHtml(o, { copy = false } = {}) {
  const s = state.settings;
  const discounts = [
    o.promo_discount > 0 && [`ส่วนลด ${o.promotion_name || 'โปรโมชั่น'}`, o.promo_discount],
    o.manual_discount > 0 && ['ส่วนลดพิเศษ', o.manual_discount],
    o.points_discount > 0 && [`แลกแต้ม (${o.points_redeemed} แต้ม)`, o.points_discount]
  ].filter(Boolean);
  const vatOn = s.vat_enabled === '1' && o.vat > 0;
  return `<div class="receipt">
    <div class="c big">${esc(s.shop_name)}</div>
    <div class="c">${esc(s.shop_address)}</div>
    <div class="c">โทร ${esc(s.shop_phone)}</div>
    ${s.tax_id ? `<div class="c">เลขผู้เสียภาษี ${esc(s.tax_id)}</div>` : ''}
    <div class="c">${vatOn ? 'ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ' : 'ใบเสร็จรับเงิน'}${copy ? ' (สำเนา)' : ''}</div>
    ${o.payment_status === 'void' ? '<div class="c big">*** ยกเลิกแล้ว ***</div>' : ''}
    <hr>
    <div class="c">คิว</div><div class="c q">${o.queue_no}</div>
    <div>เลขที่ ${esc(o.order_no)} &nbsp; ${LABELS.orderType[o.order_type]}${o.table_no ? ' โต๊ะ ' + esc(o.table_no) : ''}</div>
    <div>${thDate(o.created_at)} &nbsp; พนักงาน: ${esc(o.cashier_name || '')}</div>
    <hr>
    <table>${o.items.map((i) => `<tr><td>${i.qty} x ${esc(i.name)}${i.options.length ? `<br><small>&nbsp;&nbsp;${esc(i.options.map((x) => x.name).join(', '))}</small>` : ''}${i.note ? `<br><small>&nbsp;&nbsp;* ${esc(i.note)}</small>` : ''}</td><td style="text-align:right">${money(i.line_total)}</td></tr>`).join('')}</table>
    <hr>
    <table>
      <tr><td>รวม</td><td style="text-align:right">${money(o.subtotal)}</td></tr>
      ${discounts.map(([l, v]) => `<tr><td>${esc(l)}</td><td style="text-align:right">-${money(v)}</td></tr>`).join('')}
      ${vatOn && s.vat_inclusive !== '1' ? `<tr><td>VAT ${s.vat_rate}%</td><td style="text-align:right">${money(o.vat)}</td></tr>` : ''}
      <tr class="big"><td>ยอดสุทธิ</td><td style="text-align:right">${money(o.total)}</td></tr>
      ${vatOn && s.vat_inclusive === '1' ? `<tr><td><small>(รวม VAT ${s.vat_rate}% = ${money(o.vat)})</small></td><td></td></tr>` : ''}
      <tr><td>${LABELS.pay[o.payment_method]}</td><td style="text-align:right">${money(o.cash_received)}</td></tr>
      ${o.payment_method === 'cash' ? `<tr><td>เงินทอน</td><td style="text-align:right">${money(o.change_amount)}</td></tr>` : ''}
    </table>
    ${o.member_id ? `<hr><div>สมาชิก: ${esc(o.member_name)} (${esc(o.member_phone)})</div><div>ได้รับ ${o.points_earned} แต้ม • คงเหลือ ${o.member_points} แต้ม</div>` : ''}
    ${o.note ? `<hr><div>หมายเหตุ: ${esc(o.note)}</div>` : ''}
    <hr><div class="c">${esc(s.receipt_footer)}</div>
  </div>`;
}

export function kitchenTicketHtml(o) {
  return `<div class="receipt">
    <div class="c">ใบสั่งครัว</div><div class="c q">#${o.queue_no}</div>
    <div class="c">${LABELS.orderType[o.order_type]}${o.table_no ? ' • โต๊ะ ' + esc(o.table_no) : ''} • ${thDate(o.created_at)}</div><hr>
    ${o.items.map((i) => `<div class="big">${i.qty} x ${esc(i.name)}</div>${i.options.length ? `<div>&nbsp;- ${esc(i.options.map((x) => x.name).join(', '))}</div>` : ''}${i.note ? `<div>&nbsp;* ${esc(i.note)}</div>` : ''}`).join('')}
    ${o.note ? `<hr><div>หมายเหตุ: ${esc(o.note)}</div>` : ''}
  </div>`;
}

export const printReceipt = (o, opts) => printHtml(receiptHtml(o, opts));
export const printKitchen = (o) => printHtml(kitchenTicketHtml(o));

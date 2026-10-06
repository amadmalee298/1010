// ประวัติบิล: ค้นหา ดูรายละเอียด พิมพ์ซ้ำ ยกเลิกบิล
import { state, api, $, $$, esc, h, modal, money, baht, LABELS, action, today, timeOf, toast, can } from '../core.js';
import { printReceipt, printKitchen } from '../receipt.js';

export async function renderOrders(root) {
  let date = today();
  let status = '';
  let term = '';
  root.innerHTML = `<div class="page-head"><h2>🧾 บิลการขาย</h2>
    <div class="row"><input type="date" data-date value="${date}"><select data-status><option value="">ทุกสถานะ</option><option value="paid">ชำระแล้ว</option><option value="void">ยกเลิก</option></select>
    <input type="search" data-q placeholder="เลขบิล / เบอร์สมาชิก"></div></div>
    <div class="grid kpi" data-kpi style="margin-bottom:14px"></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>คิว</th><th>เลขที่</th><th>เวลา</th><th>ประเภท</th><th>รายการ</th><th>ชำระ</th><th>สถานะครัว</th><th>พนักงาน</th><th class="right">ยอด</th></tr></thead><tbody data-rows></tbody></table></div>`;

  async function load() {
    const params = new URLSearchParams({ date, ...(status && { status }), ...(term && { q: term }) });
    const rows = await api('/orders?' + params);
    const paid = rows.filter((r) => r.payment_status === 'paid');
    $('[data-kpi]', root).innerHTML = [
      ['จำนวนบิล', paid.length], ['ยอดขาย', baht(paid.reduce((s, r) => s + r.total, 0))],
      ['เงินสด', baht(paid.filter((r) => r.payment_method === 'cash').reduce((s, r) => s + r.total, 0))],
      ['ยกเลิก', rows.length - paid.length]
    ].map(([l, v]) => `<div class="card kpi-card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');
    $('[data-rows]', root).innerHTML = rows.length ? rows.map((r) => `<tr class="clickable ${r.payment_status === 'void' ? 'dim' : ''}" data-id="${r.id}">
      <td><b>${r.queue_no}</b></td><td>${esc(r.order_no)}</td><td>${timeOf(r.created_at)}</td><td>${LABELS.orderType[r.order_type]}${r.table_no ? ' • ' + esc(r.table_no) : ''}</td>
      <td>${r.item_count} ชิ้น${r.member_name ? ` <span class="badge brand">⭐ ${esc(r.member_name)}</span>` : ''}</td>
      <td>${LABELS.payIcon[r.payment_method]} ${LABELS.pay[r.payment_method]}</td>
      <td>${r.payment_status === 'void' ? '<span class="badge danger">ยกเลิก</span>' : `<span class="badge ${LABELS.statusBadge[r.status]}">${LABELS.status[r.status]}</span>`}</td>
      <td>${esc(r.cashier_name)}</td><td class="right num"><b>${money(r.total)}</b></td></tr>`).join('') : '<tr><td colspan="9" class="center muted">ไม่มีบิล</td></tr>';
    $$('[data-id]', root).forEach((tr) => tr.onclick = () => showOrder(Number(tr.dataset.id), load));
  }
  $('[data-date]', root).onchange = (e) => { date = e.target.value; load(); };
  $('[data-status]', root).onchange = (e) => { status = e.target.value; load(); };
  let t; $('[data-q]', root).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { term = e.target.value.trim(); load(); }, 300); };
  await load();
}

export async function showOrder(id, onChange) {
  const o = await api('/orders/' + id);
  const body = h(`<div>
    <div class="row between"><div><h3 style="margin:0">คิว ${o.queue_no} • ${esc(o.order_no)}</h3><div class="muted small">${esc(o.created_at)} • ${esc(o.cashier_name)} • ${LABELS.orderType[o.order_type]}${o.table_no ? ' ' + esc(o.table_no) : ''}</div></div>
    ${o.payment_status === 'void' ? '<span class="badge danger">ยกเลิกแล้ว</span>' : `<span class="badge ${LABELS.statusBadge[o.status]}">${LABELS.status[o.status]}</span>`}</div>
    ${o.payment_status === 'void' ? `<div class="card" style="margin-top:10px;background:var(--danger-soft)">เหตุผล: ${esc(o.void_reason)} • ${esc(o.voided_at)}</div>` : ''}
    <table class="table" style="margin-top:10px"><tbody>${o.items.map((i) => `<tr><td>${i.qty} ×</td><td>${esc(i.name)}<div class="small muted">${esc(i.options.map((x) => x.name).join(' • '))}${i.note ? ' 📝 ' + esc(i.note) : ''}</div></td><td class="right">${money(i.line_total)}</td></tr>`).join('')}</tbody></table>
    <div style="margin-top:10px">
      <div class="sum-row"><span>รวม</span><span>${money(o.subtotal)}</span></div>
      ${o.promo_discount ? `<div class="sum-row disc"><span>${esc(o.promotion_name || 'โปรโมชั่น')}</span><span>-${money(o.promo_discount)}</span></div>` : ''}
      ${o.manual_discount ? `<div class="sum-row disc"><span>ส่วนลดพิเศษ</span><span>-${money(o.manual_discount)}</span></div>` : ''}
      ${o.points_discount ? `<div class="sum-row disc"><span>แลก ${o.points_redeemed} แต้ม</span><span>-${money(o.points_discount)}</span></div>` : ''}
      ${o.vat ? `<div class="sum-row small muted"><span>VAT</span><span>${money(o.vat)}</span></div>` : ''}
      <div class="sum-row total"><span>สุทธิ</span><span>${baht(o.total)}</span></div>
      <div class="sum-row small"><span>${LABELS.pay[o.payment_method]} รับ ${money(o.cash_received)}</span><span>ทอน ${money(o.change_amount)}</span></div>
      ${o.member_id ? `<div class="small">⭐ ${esc(o.member_name)} (${esc(o.member_phone)}) • ได้ ${o.points_earned} แต้ม</div>` : ''}
      ${can('owner', 'manager') ? `<div class="small muted">ต้นทุนวัตถุดิบ ${money(o.cost)} • กำไรขั้นต้น ${money(o.total - o.vat - o.cost)}</div>` : ''}
    </div></div>`);
  const m = modal({
    title: '🧾 รายละเอียดบิล', body,
    foot: `${o.payment_status === 'paid' ? '<button class="btn danger" data-void>ยกเลิกบิล</button>' : ''}<div class="grow"></div><button class="btn" data-k>ใบสั่งครัว</button><button class="btn primary" data-r>🖨️ พิมพ์ใบเสร็จ</button>`
  });
  $('[data-r]', m.el).onclick = () => printReceipt(o, { copy: true });
  $('[data-k]', m.el).onclick = () => printKitchen(o);
  $('[data-void]', m.el)?.addEventListener('click', () => {
    const isMgr = can('owner', 'manager');
    const vb = h(`<div><p>ยกเลิกบิล <b>${esc(o.order_no)}</b> ยอด ${baht(o.total)} — ระบบจะคืนสต็อกและแต้มสมาชิกให้อัตโนมัติ</p>
      <label class="field"><span>เหตุผล</span><input name="reason" placeholder="เช่น ลูกค้าเปลี่ยนใจ / คีย์ผิด"></label>
      ${isMgr ? '' : '<label class="field"><span>🔐 PIN ผู้จัดการ</span><input type="password" inputmode="numeric" name="manager_pin"></label>'}</div>`);
    const vm = modal({ title: 'ยกเลิกบิล', body: vb, foot: '<button class="btn danger" data-ok>ยืนยันยกเลิก</button>' });
    $('[data-ok]', vm.el).onclick = action(async () => {
      await api(`/orders/${o.id}/void`, { method: 'POST', body: { reason: $('[name=reason]', vb).value, manager_pin: $('[name=manager_pin]', vb)?.value } });
      vm.close(); m.close(); toast('ยกเลิกบิลแล้ว', 'ok'); onChange?.();
    });
  });
}

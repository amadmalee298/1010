// กะการขาย / ลิ้นชักเงินสด: เปิดกะ, เงินเข้า-ออก, ปิดกะพร้อมนับเงิน
import { state, api, $, $$, esc, h, modal, money, baht, LABELS, action, formData, toast, can, thDate, printHtml } from '../core.js';

const DENOMS = [1000, 500, 100, 50, 20, 10, 5, 2, 1];

export async function renderShift(root) {
  async function load() {
    const cur = await api('/shifts/current');
    state.shift = cur.shift;
    if (!cur.shift) {
      root.innerHTML = `<div class="page-head"><h2>💰 กะการขาย</h2></div>
        <div class="card" style="max-width:420px"><h3>ยังไม่ได้เปิดกะ</h3>
        <label class="field"><span>เงินทอนตั้งต้นในลิ้นชัก (บาท)</span><input type="number" min="0" name="opening_cash" value="1000"></label>
        <button class="btn primary block" data-open>เปิดกะ</button></div><div data-history style="margin-top:20px"></div>`;
      $('[data-open]', root).onclick = action(async () => {
        await api('/shifts/open', { method: 'POST', body: formData(root) }); toast('เปิดกะแล้ว', 'ok'); load();
      });
    } else {
      const s = cur;
      root.innerHTML = `<div class="page-head"><h2>💰 กะปัจจุบัน</h2><div class="row">
        <button class="btn" data-cash="in">➕ นำเงินเข้า</button><button class="btn" data-cash="out">➖ นำเงินออก</button><button class="btn danger" data-close>ปิดกะ</button></div></div>
        <p class="muted">เปิดโดย ${esc(s.shift.user_name)} เมื่อ ${thDate(s.shift.opened_at)}</p>
        <div class="grid kpi">
          ${[['ยอดขายรวม', baht(s.total_sales)], ['จำนวนบิล', s.order_count], ['เงินทอนตั้งต้น', baht(s.shift.opening_cash)], ['ขายเงินสด', baht(s.cash_sales)],
            ['เงินเข้า/ออก', `+${money(s.cash_in)} / -${money(s.cash_out)}`], ['เงินสดที่ควรมีในลิ้นชัก', baht(s.expected_cash)]]
            .map(([l, v]) => `<div class="card kpi-card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('')}
        </div>
        <div class="grid cols-2" style="margin-top:14px">
          <div class="card"><h3>แยกตามวิธีชำระ</h3>${s.sales.map((x) => `<div class="sum-row"><span>${LABELS.payIcon[x.payment_method]} ${LABELS.pay[x.payment_method]} (${x.count})</span><b>${baht(x.total)}</b></div>`).join('') || '<p class="muted">ยังไม่มีการขาย</p>'}
            ${s.voids.count ? `<div class="sum-row" style="color:var(--danger)"><span>ยกเลิก ${s.voids.count} บิล</span><span>${baht(s.voids.total)}</span></div>` : ''}</div>
          <div class="card"><h3>เงินเข้า/ออกลิ้นชัก</h3>${s.cash_movements.map((m) => `<div class="sum-row"><span>${m.type === 'in' ? '➕' : '➖'} ${esc(m.reason)} <span class="small muted">${esc(m.user_name || '')} ${thDate(m.created_at)}</span></span><b>${money(m.amount)}</b></div>`).join('') || '<p class="muted">ไม่มีรายการ</p>'}</div>
        </div><div data-history style="margin-top:20px"></div>`;
      $$('[data-cash]', root).forEach((b) => b.onclick = () => cashMove(b.dataset.cash));
      $('[data-close]', root).onclick = () => closeShift(s);
    }
    if (can('owner', 'manager')) history();
  }

  function cashMove(type) {
    const f = h(`<div><label class="field"><span>จำนวนเงิน</span><input name="amount" type="number" min="0" step="any"></label>
      <label class="field"><span>เหตุผล</span><input name="reason" placeholder="${type === 'in' ? 'เช่น เติมเงินทอน' : 'เช่น ซื้อน้ำแข็ง / ฝากธนาคาร'}"></label></div>`);
    const m = modal({ title: type === 'in' ? 'นำเงินเข้าลิ้นชัก' : 'นำเงินออกจากลิ้นชัก', body: f, foot: '<button class="btn primary" data-save>บันทึก</button>' });
    $('[data-save]', m.el).onclick = action(async () => {
      await api('/shifts/cash', { method: 'POST', body: { ...formData(f), type } }); m.close(); toast('บันทึกแล้ว', 'ok'); load();
    });
  }

  function closeShift(s) {
    const f = h(`<div><p>นับเงินในลิ้นชักตามชนิดธนบัตร/เหรียญ</p>
      <div class="form-grid" style="grid-template-columns:repeat(3,1fr)">${DENOMS.map((d) => `<label class="field"><span>฿${d}</span><input type="number" min="0" data-d="${d}" placeholder="0"></label>`).join('')}</div>
      <div class="sum-row"><span>นับได้</span><b data-counted>฿0.00</b></div>
      <div class="sum-row"><span>ระบบคำนวณ</span><b>${baht(s.expected_cash)}</b></div>
      <div class="sum-row total"><span>ส่วนต่าง</span><span data-diff>-</span></div>
      <label class="field"><span>หมายเหตุ</span><input name="note"></label></div>`);
    const m = modal({ title: 'ปิดกะ', body: f, foot: '<button class="btn danger" data-save>ยืนยันปิดกะ</button>' });
    const counted = () => $$('[data-d]', f).reduce((sum, i) => sum + Number(i.dataset.d) * (Number(i.value) || 0), 0);
    $$('[data-d]', f).forEach((i) => i.oninput = () => {
      const c = counted(); const d = c - s.expected_cash;
      $('[data-counted]', f).textContent = baht(c);
      $('[data-diff]', f).innerHTML = `<span style="color:${Math.abs(d) < 0.01 ? 'var(--ok)' : 'var(--danger)'}">${d > 0 ? '+' : ''}${money(d)}</span>`;
    });
    $('[data-save]', m.el).onclick = action(async () => {
      const res = await api('/shifts/close', { method: 'POST', body: { counted_cash: counted(), note: $('[name=note]', f).value } });
      m.close();
      toast(`ปิดกะแล้ว ส่วนต่าง ${money(res.difference)} บาท`, Math.abs(res.difference) < 0.01 ? 'ok' : 'error');
      printHtml(`<div class="receipt"><div class="c big">${esc(state.settings.shop_name)}</div><div class="c">สรุปปิดกะ #${res.shift.id}</div><hr>
        <div>เปิด: ${thDate(res.shift.opened_at)} (${esc(res.shift.user_name)})</div><div>ปิด: ${thDate(res.shift.closed_at)} (${esc(state.user.name)})</div><hr>
        <table>${res.sales.map((x) => `<tr><td>${LABELS.pay[x.payment_method]} (${x.count})</td><td style="text-align:right">${money(x.total)}</td></tr>`).join('')}
        <tr class="big"><td>ยอดขายรวม</td><td style="text-align:right">${money(res.total_sales)}</td></tr>
        <tr><td>ยกเลิก ${res.voids.count} บิล</td><td style="text-align:right">${money(res.voids.total)}</td></tr></table><hr>
        <table><tr><td>เงินทอนตั้งต้น</td><td style="text-align:right">${money(res.shift.opening_cash)}</td></tr><tr><td>ขายเงินสด</td><td style="text-align:right">${money(res.cash_sales)}</td></tr>
        <tr><td>เงินเข้า</td><td style="text-align:right">${money(res.cash_in)}</td></tr><tr><td>เงินออก</td><td style="text-align:right">-${money(res.cash_out)}</td></tr>
        <tr><td>ควรมี</td><td style="text-align:right">${money(res.expected_cash)}</td></tr><tr><td>นับได้</td><td style="text-align:right">${money(res.shift.counted_cash)}</td></tr>
        <tr class="big"><td>ส่วนต่าง</td><td style="text-align:right">${money(res.difference)}</td></tr></table></div>`);
      load();
    });
  }

  async function history() {
    const rows = await api('/shifts');
    const el = $('[data-history]', root);
    if (!el) return;
    el.innerHTML = `<h3>ประวัติกะ</h3><div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>เปิด</th><th>ปิด</th><th class="right">บิล</th><th class="right">ยอดขาย</th><th class="right">เงินที่ควรมี</th><th class="right">นับได้</th><th class="right">ส่วนต่าง</th></tr></thead><tbody>
      ${rows.map((r) => { const d = r.counted_cash == null ? null : r.counted_cash - r.expected_cash; return `<tr><td>${r.id}</td><td class="small">${thDate(r.opened_at)}<br>${esc(r.user_name)}</td><td class="small">${r.closed_at ? thDate(r.closed_at) + '<br>' + esc(r.closed_by_name || '') : '<span class="badge ok">เปิดอยู่</span>'}</td>
        <td class="right">${r.order_count}</td><td class="right num">${money(r.total_sales)}</td><td class="right num">${r.expected_cash == null ? '-' : money(r.expected_cash)}</td><td class="right num">${r.counted_cash == null ? '-' : money(r.counted_cash)}</td>
        <td class="right">${d == null ? '-' : `<span class="badge ${Math.abs(d) < 0.01 ? 'ok' : 'danger'}">${d > 0 ? '+' : ''}${money(d)}</span>`}</td></tr>`; }).join('')}</tbody></table></div>`;
  }
  await load();
}

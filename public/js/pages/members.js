// สมาชิกและแต้มสะสม
import { api, $, $$, esc, h, modal, money, baht, action, formData, toast, can, thDate } from '../core.js';

export async function renderMembers(root) {
  let term = '';
  root.innerHTML = `<div class="page-head"><h2>⭐ สมาชิก</h2><div class="row"><input type="search" data-q placeholder="ค้นหาชื่อ / เบอร์โทร"><button class="btn primary" data-add>+ สมัครสมาชิก</button></div></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>ชื่อ</th><th>เบอร์โทร</th><th class="right">แต้ม</th><th class="right">ยอดซื้อสะสม</th><th class="right">มาใช้บริการ</th><th>สมัครเมื่อ</th></tr></thead><tbody data-rows></tbody></table></div>`;

  async function load() {
    const rows = await api('/members?q=' + encodeURIComponent(term));
    $('[data-rows]', root).innerHTML = rows.map((m) => `<tr class="clickable" data-id="${m.id}"><td><b>${esc(m.name)}</b></td><td>${esc(m.phone)}</td>
      <td class="right"><span class="badge brand">${m.points}</span></td><td class="right num">${money(m.total_spent)}</td><td class="right">${m.visits} ครั้ง</td><td class="small muted">${thDate(m.created_at)}</td></tr>`).join('')
      || '<tr><td colspan="6" class="center muted">ไม่พบสมาชิก</td></tr>';
    $$('[data-id]', root).forEach((tr) => tr.onclick = () => edit(Number(tr.dataset.id)));
  }

  async function edit(id = null) {
    const m0 = id ? await api('/members/' + id) : null;
    const f = h(`<div><div class="form-grid">
      <label class="field"><span>ชื่อ</span><input name="name" value="${esc(m0?.name || '')}"></label>
      <label class="field"><span>เบอร์โทร</span><input name="phone" inputmode="numeric" value="${esc(m0?.phone || '')}"></label>
      <label class="field"><span>วันเกิด</span><input name="birthday" type="date" value="${esc(m0?.birthday || '')}"></label>
      ${m0 && can('owner', 'manager') ? `<label class="field"><span>แต้ม (ปรับโดยผู้จัดการ)</span><input name="points" type="number" min="0" value="${m0.points}"></label>` : ''}</div>
      <label class="field"><span>หมายเหตุ (เช่น แพ้อาหาร / ชอบหวานน้อย)</span><input name="note" value="${esc(m0?.note || '')}"></label>
      ${m0 ? `<h3>ประวัติการซื้อล่าสุด</h3><div class="table-wrap" style="max-height:240px"><table class="table"><tbody>${m0.orders.map((o) => `<tr class="${o.payment_status === 'void' ? 'dim' : ''}"><td>${esc(o.order_no)}</td><td class="small">${thDate(o.created_at)}</td><td class="right">${baht(o.total)}</td><td class="small">+${o.points_earned}${o.points_redeemed ? ` / -${o.points_redeemed}` : ''} แต้ม</td></tr>`).join('') || '<tr><td class="muted">ยังไม่มี</td></tr>'}</tbody></table></div>` : ''}</div>`);
    const m = modal({ title: m0 ? `สมาชิก: ${esc(m0.name)}` : 'สมัครสมาชิก', body: f, wide: !!m0, foot: '<button class="btn primary" data-save>บันทึก</button>' });
    $('[data-save]', m.el).onclick = action(async () => {
      await api(m0 ? `/members/${id}` : '/members', { method: m0 ? 'PUT' : 'POST', body: formData(f) });
      m.close(); toast('บันทึกแล้ว', 'ok'); load();
    });
  }

  let t; $('[data-q]', root).oninput = (e) => { clearTimeout(t); t = setTimeout(() => { term = e.target.value.trim(); load(); }, 250); };
  $('[data-add]', root).onclick = () => edit();
  await load();
}

// พนักงาน + ตั้งค่าร้าน (เฉพาะเจ้าของร้าน)
import { state, api, $, $$, esc, h, modal, action, formData, toast, LABELS, thDate } from '../core.js';

export async function renderUsers(root) {
  root.innerHTML = `<div class="page-head"><h2>👥 พนักงาน</h2><button class="btn primary" data-add>+ เพิ่มพนักงาน</button></div>
    <div class="table-wrap"><table class="table"><thead><tr><th></th><th>ชื่อ</th><th>ตำแหน่ง</th><th>สถานะ</th><th>สร้างเมื่อ</th></tr></thead><tbody data-rows></tbody></table></div>
    <div class="card" style="margin-top:16px"><h3>สิทธิ์การใช้งาน</h3><table class="table small"><thead><tr><th>ส่วน</th><th>เจ้าของร้าน</th><th>ผู้จัดการ</th><th>แคชเชียร์</th><th>ครัว</th></tr></thead><tbody>
    ${[['ขาย / บิล / กะ / สมาชิก', 1, 1, 1, 0], ['จอครัว', 1, 1, 1, 1], ['รับสต็อก / ของเสีย', 1, 1, 1, 0], ['นับสต็อก / แก้เมนู / โปรโมชั่น / รายงาน', 1, 1, 0, 0],
      ['ยกเลิกบิล / ส่วนลดเกินกำหนด', 1, 1, 'PIN ผจก.', 0], ['พนักงาน / ตั้งค่าร้าน', 1, 0, 0, 0]]
      .map(([n, ...r]) => `<tr><td>${n}</td>${r.map((v) => `<td>${v === 1 ? '✅' : v === 0 ? '—' : v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  async function load() {
    const users = await api('/users');
    $('[data-rows]', root).innerHTML = users.map((u) => `<tr class="clickable ${u.active ? '' : 'dim'}" data-id="${u.id}"><td>${LABELS.roleIcon[u.role]}</td><td><b>${esc(u.name)}</b></td><td>${LABELS.role[u.role]}</td>
      <td>${u.active ? '<span class="badge ok">ใช้งาน</span>' : '<span class="badge">ปิด</span>'}</td><td class="small muted">${thDate(u.created_at)}</td></tr>`).join('');
    $$('[data-id]', root).forEach((tr) => tr.onclick = () => edit(users.find((u) => u.id === Number(tr.dataset.id))));
  }
  function edit(u = null) {
    const f = h(`<div class="form-grid">
      <label class="field"><span>ชื่อ</span><input name="name" value="${esc(u?.name || '')}"></label>
      <label class="field"><span>ตำแหน่ง</span><select name="role">${Object.entries(LABELS.role).map(([k, v]) => `<option value="${k}" ${u?.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>${u ? 'PIN ใหม่ (เว้นว่าง = ไม่เปลี่ยน)' : 'PIN (4-6 หลัก)'}</span><input name="pin" type="password" inputmode="numeric" maxlength="6"></label>
      ${u ? `<label class="chk"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> ใช้งาน</label>` : ''}</div>`);
    const m = modal({ title: u ? 'แก้ไขพนักงาน' : 'เพิ่มพนักงาน', body: f, foot: '<button class="btn primary" data-save>บันทึก</button>' });
    $('[data-save]', m.el).onclick = action(async () => {
      await api(u ? `/users/${u.id}` : '/users', { method: u ? 'PUT' : 'POST', body: formData(f) });
      m.close(); toast('บันทึกแล้ว', 'ok'); load();
    });
  }
  $('[data-add]', root).onclick = () => edit();
  await load();
}

export async function renderSettings(root) {
  const s = await api('/settings');
  const field = (name, label, type = 'text', extra = '') => `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(s[name] ?? '')}" ${extra}></label>`;
  root.innerHTML = `<div class="page-head"><h2>⚙️ ตั้งค่าร้าน</h2><button class="btn primary" data-save>บันทึก</button></div>
    <div class="grid cols-2">
      <div class="card"><h3>ข้อมูลร้าน (แสดงบนใบเสร็จ)</h3>${field('shop_name', 'ชื่อร้าน')}${field('shop_address', 'ที่อยู่')}${field('shop_phone', 'เบอร์โทร')}${field('tax_id', 'เลขผู้เสียภาษี (ถ้ามี)')}${field('receipt_footer', 'ข้อความท้ายใบเสร็จ')}</div>
      <div class="card"><h3>ภาษีมูลค่าเพิ่ม</h3>
        <label class="chk"><input type="checkbox" name="vat_enabled" ${s.vat_enabled === '1' ? 'checked' : ''}> จด VAT</label>
        ${field('vat_rate', 'อัตรา VAT (%)', 'number', 'min="0" step="any"')}
        <label class="chk"><input type="checkbox" name="vat_inclusive" ${s.vat_inclusive === '1' ? 'checked' : ''}> ราคาสินค้ารวม VAT แล้ว</label>
        <h3 style="margin-top:16px">การชำระเงิน</h3>${field('promptpay_id', 'พร้อมเพย์ (เบอร์มือถือ / เลขผู้เสียภาษี)')}
        ${field('max_cashier_discount', 'ส่วนลดสูงสุดที่แคชเชียร์ให้ได้เอง (บาท)', 'number', 'min="0"')}</div>
      <div class="card"><h3>สะสมแต้มสมาชิก</h3>${field('baht_per_point', 'ซื้อกี่บาทได้ 1 แต้ม', 'number', 'min="0"')}${field('point_value', '1 แต้มมีค่ากี่บาท', 'number', 'min="0" step="any"')}${field('min_redeem_points', 'แลกขั้นต่ำ (แต้ม)', 'number', 'min="0"')}</div>
      <div class="card"><h3>ประวัติการใช้งานระบบ (Audit log)</h3><div data-audit class="table-wrap" style="max-height:320px"></div></div>
    </div>`;
  $('[data-save]', root).onclick = action(async () => {
    state.settings = await api('/settings', { method: 'PUT', body: formData(root) });
    toast('บันทึกการตั้งค่าแล้ว', 'ok');
  });
  const logs = await api('/audit');
  $('[data-audit]', root).innerHTML = `<table class="table small"><tbody>${logs.map((l) => `<tr><td>${thDate(l.created_at)}</td><td>${esc(l.user_name || '-')}</td><td>${esc(l.action)}</td><td class="muted">${esc((l.detail || '').slice(0, 80))}</td></tr>`).join('')}</tbody></table>`;
}

// โปรโมชั่น / โค้ดส่วนลด
import { api, $, $$, esc, h, modal, action, formData, toast, can } from '../core.js';

export async function renderPromotions(root) {
  const isMgr = can('owner', 'manager');
  root.innerHTML = `<div class="page-head"><h2>🏷️ โปรโมชั่น</h2>${isMgr ? '<button class="btn primary" data-add>+ เพิ่มโปรโมชั่น</button>' : ''}</div><div class="grid cols-2" data-list></div>`;

  async function load() {
    const list = await api('/promotions');
    $('[data-list]', root).innerHTML = list.map((p) => `<div class="card" data-id="${p.id}" style="${isMgr ? 'cursor:pointer;' : ''}${p.active ? '' : 'opacity:.55'}">
      <div class="row between"><h3 style="margin:0">${esc(p.name)}</h3>${p.active ? '<span class="badge ok">ใช้งาน</span>' : '<span class="badge">ปิด</span>'}</div>
      <div style="font-size:1.6rem;font-weight:700;color:var(--brand-dark);margin:6px 0">${p.type === 'percent' ? `ลด ${p.value}%` : `ลด ฿${p.value}`}</div>
      <div class="row small">${p.code ? `<span class="badge info">โค้ด ${esc(p.code)}</span>` : ''}${p.min_total ? `<span class="badge">ขั้นต่ำ ฿${p.min_total}</span>` : ''}${p.max_discount ? `<span class="badge">ลดสูงสุด ฿${p.max_discount}</span>` : ''}${p.members_only ? '<span class="badge brand">⭐ สมาชิกเท่านั้น</span>' : ''}${p.start_date || p.end_date ? `<span class="badge">${esc(p.start_date || '…')} → ${esc(p.end_date || '…')}</span>` : ''}</div></div>`).join('') || '<p class="muted">ยังไม่มีโปรโมชั่น</p>';
    if (isMgr) $$('[data-id]', root).forEach((c) => c.onclick = () => edit(list.find((p) => p.id === Number(c.dataset.id))));
  }

  function edit(p = null) {
    const f = h(`<div><div class="form-grid">
      <label class="field"><span>ชื่อโปรโมชั่น</span><input name="name" value="${esc(p?.name || '')}"></label>
      <label class="field"><span>โค้ด (ไม่บังคับ)</span><input name="code" value="${esc(p?.code || '')}" style="text-transform:uppercase"></label>
      <label class="field"><span>ประเภท</span><select name="type"><option value="percent" ${p?.type === 'percent' ? 'selected' : ''}>ลดเป็น %</option><option value="amount" ${p?.type === 'amount' ? 'selected' : ''}>ลดเป็นบาท</option></select></label>
      <label class="field"><span>มูลค่า</span><input name="value" type="number" min="0" step="any" value="${p?.value ?? ''}"></label>
      <label class="field"><span>ยอดขั้นต่ำ (บาท)</span><input name="min_total" type="number" min="0" value="${p?.min_total ?? 0}"></label>
      <label class="field"><span>ลดสูงสุด (0 = ไม่จำกัด)</span><input name="max_discount" type="number" min="0" value="${p?.max_discount ?? 0}"></label>
      <label class="field"><span>เริ่ม</span><input name="start_date" type="date" value="${esc(p?.start_date || '')}"></label>
      <label class="field"><span>สิ้นสุด</span><input name="end_date" type="date" value="${esc(p?.end_date || '')}"></label></div>
      <div class="row"><label class="chk"><input type="checkbox" name="members_only" ${p?.members_only ? 'checked' : ''}> สมาชิกเท่านั้น</label>
      <label class="chk"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}> เปิดใช้งาน</label></div></div>`);
    const m = modal({ title: p ? 'แก้ไขโปรโมชั่น' : 'เพิ่มโปรโมชั่น', body: f, foot: '<button class="btn primary" data-save>บันทึก</button>' });
    $('[data-save]', m.el).onclick = action(async () => {
      await api(p ? `/promotions/${p.id}` : '/promotions', { method: p ? 'PUT' : 'POST', body: formData(f) });
      m.close(); toast('บันทึกแล้ว', 'ok'); load();
    });
  }
  $('[data-add]', root)?.addEventListener('click', () => edit());
  await load();
}

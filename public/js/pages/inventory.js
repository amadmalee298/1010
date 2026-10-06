// สต็อกวัตถุดิบ: รับเข้า / ของเสีย / นับสต็อก / ประวัติการเคลื่อนไหว
import { api, $, $$, esc, h, modal, money, numFmt, action, formData, toast, can, LABELS, thDate } from '../core.js';

export async function renderInventory(root) {
  const isMgr = can('owner', 'manager');
  let tab = 'stock';
  root.innerHTML = `<div class="page-head"><h2>📦 สต็อกวัตถุดิบ</h2>${isMgr ? '<button class="btn primary" data-add>+ วัตถุดิบใหม่</button>' : ''}</div>
    <div class="tabs"><button data-tab="stock">คงเหลือ</button>${isMgr ? '<button data-tab="moves">ประวัติเคลื่อนไหว</button>' : ''}</div>
    <div data-body></div>`;
  const body = $('[data-body]', root);
  let items = [];

  async function load() {
    $$('[data-tab]', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'moves') return loadMoves();
    items = await api('/ingredients');
    const low = items.filter((i) => i.low);
    const value = items.reduce((s, i) => s + Math.max(0, i.stock) * i.cost_per_unit, 0);
    body.innerHTML = `<div class="grid kpi" style="margin-bottom:14px">
        <div class="card kpi-card"><div class="label">รายการวัตถุดิบ</div><div class="value">${items.length}</div></div>
        <div class="card kpi-card"><div class="label">ใกล้หมด / ต่ำกว่าขั้นต่ำ</div><div class="value" style="color:${low.length ? 'var(--danger)' : 'var(--ok)'}">${low.length}</div></div>
        ${isMgr ? `<div class="card kpi-card"><div class="label">มูลค่าสต็อก</div><div class="value">฿${money(value)}</div></div>` : ''}
      </div>
      <div class="table-wrap"><table class="table"><thead><tr><th>วัตถุดิบ</th><th class="right">คงเหลือ</th><th class="right">ขั้นต่ำ</th><th style="width:20%">ระดับ</th>${isMgr ? '<th class="right">ต้นทุน/หน่วย</th>' : ''}<th></th></tr></thead><tbody>
      ${items.map((i) => {
        const pct = i.min_stock > 0 ? Math.min(100, i.stock / (i.min_stock * 3) * 100) : 100;
        return `<tr><td><b>${esc(i.name)}</b> <span class="muted small">${esc(i.unit)}</span> ${i.low ? '<span class="badge danger">ต้องสั่งเพิ่ม</span>' : ''}</td>
        <td class="right num"><b>${numFmt(i.stock)}</b></td><td class="right num muted">${numFmt(i.min_stock)}</td>
        <td><div class="hbar"><div style="width:${Math.max(0, pct)}%;background:${i.low ? 'var(--danger)' : 'var(--ok)'}"></div></div></td>
        ${isMgr ? `<td class="right num">${money(i.cost_per_unit)}</td>` : ''}
        <td class="right"><button class="btn sm ok" data-act="purchase" data-id="${i.id}">+ รับเข้า</button> <button class="btn sm" data-act="waste" data-id="${i.id}">ของเสีย</button>
        ${isMgr ? `<button class="btn sm" data-act="adjust" data-id="${i.id}">นับสต็อก</button> <button class="btn sm ghost" data-edit="${i.id}">✏️</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    $$('[data-act]', body).forEach((b) => b.onclick = () => adjust(items.find((i) => i.id === Number(b.dataset.id)), b.dataset.act));
    $$('[data-edit]', body).forEach((b) => b.onclick = () => edit(items.find((i) => i.id === Number(b.dataset.edit))));
  }

  function adjust(i, reason) {
    const titles = { purchase: `รับเข้า: ${i.name}`, waste: `บันทึกของเสีย: ${i.name}`, adjust: `นับสต็อกจริง: ${i.name}` };
    const f = h(`<div><p class="muted">คงเหลือในระบบ ${numFmt(i.stock)} ${esc(i.unit)}</p>
      <label class="field"><span>${reason === 'adjust' ? 'จำนวนที่นับได้จริง' : 'จำนวน'} (${esc(i.unit)})</span><input name="qty" type="number" min="0" step="any"></label>
      ${reason === 'purchase' && isMgr ? `<label class="field"><span>ต้นทุนต่อหน่วยใหม่ (เว้นว่าง = เท่าเดิม ${money(i.cost_per_unit)})</span><input name="cost_per_unit" type="number" min="0" step="any"></label>` : ''}
      <label class="field"><span>หมายเหตุ</span><input name="note" placeholder="${reason === 'purchase' ? 'ซัพพลายเออร์ / เลขบิล' : reason === 'waste' ? 'เช่น หมดอายุ / ทำหก' : ''}"></label></div>`);
    const m = modal({ title: titles[reason], body: f, foot: '<button class="btn primary" data-save>บันทึก</button>' });
    $('[data-save]', m.el).onclick = action(async () => {
      await api(`/ingredients/${i.id}/adjust`, { method: 'POST', body: { ...formData(f), reason } });
      m.close(); toast('บันทึกสต็อกแล้ว', 'ok'); load();
    });
  }

  function edit(i = null) {
    const f = h(`<div class="form-grid">
      <label class="field"><span>ชื่อวัตถุดิบ</span><input name="name" value="${esc(i?.name || '')}"></label>
      <label class="field"><span>หน่วย</span><input name="unit" value="${esc(i?.unit || '')}" placeholder="กรัม / มล. / ฟอง"></label>
      <label class="field"><span>สต็อกขั้นต่ำ (แจ้งเตือน)</span><input name="min_stock" type="number" min="0" step="any" value="${i?.min_stock ?? 0}"></label>
      <label class="field"><span>ต้นทุนต่อหน่วย (บาท)</span><input name="cost_per_unit" type="number" min="0" step="any" value="${i?.cost_per_unit ?? 0}"></label>
      ${i ? '' : '<label class="field"><span>สต็อกเริ่มต้น</span><input name="stock" type="number" min="0" step="any" value="0"></label>'}</div>`);
    const m = modal({ title: i ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบ', body: f, foot: `${i ? '<button class="btn danger" data-del>ลบ</button><div class="grow"></div>' : ''}<button class="btn primary" data-save>บันทึก</button>` });
    $('[data-save]', m.el).onclick = action(async () => {
      await api(i ? `/ingredients/${i.id}` : '/ingredients', { method: i ? 'PUT' : 'POST', body: formData(f) });
      m.close(); toast('บันทึกแล้ว', 'ok'); load();
    });
    $('[data-del]', m.el)?.addEventListener('click', action(async () => {
      if (!confirm(`ลบ ${i.name}? (ประวัติยังคงอยู่)`)) return;
      await api(`/ingredients/${i.id}`, { method: 'DELETE' }); m.close(); load();
    }));
  }

  async function loadMoves() {
    const rows = await api('/stock-movements');
    body.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>เวลา</th><th>วัตถุดิบ</th><th>ประเภท</th><th class="right">เปลี่ยนแปลง</th><th class="right">คงเหลือ</th><th>อ้างอิง</th><th>ผู้ทำ</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="small">${thDate(r.created_at)}</td><td>${esc(r.ingredient_name)}</td>
        <td><span class="badge ${r.reason === 'purchase' ? 'ok' : r.reason === 'waste' ? 'danger' : r.reason === 'sale' ? 'brand' : 'info'}">${LABELS.stock[r.reason]}</span></td>
        <td class="right num" style="color:${r.change >= 0 ? 'var(--ok)' : 'var(--danger)'}">${r.change >= 0 ? '+' : ''}${numFmt(r.change)} ${esc(r.unit)}</td>
        <td class="right num">${numFmt(r.balance)}</td><td class="small">${esc(r.ref || '')} ${esc(r.note || '')}</td><td class="small">${esc(r.user_name || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="center muted">ไม่มีข้อมูล</td></tr>'}
      </tbody></table></div>`;
  }

  $$('[data-tab]', root).forEach((b) => b.onclick = () => { tab = b.dataset.tab; load(); });
  $('[data-add]', root)?.addEventListener('click', () => edit());
  await load();
}

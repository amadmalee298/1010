// จัดการเมนู: สินค้า + สูตร(ตัดสต็อก), กลุ่มตัวเลือก, หมวดหมู่
import { api, $, $$, esc, h, modal, money, action, formData, toast } from '../core.js';

export async function renderProducts(root) {
  let tab = 'products';
  root.innerHTML = `<div class="page-head"><h2>🍮 จัดการเมนู</h2><button class="btn primary" data-add>+ เพิ่ม</button></div>
    <div class="tabs"><button data-tab="products">สินค้า</button><button data-tab="groups">ตัวเลือก (ท็อปปิ้ง/ความหวาน)</button><button data-tab="categories">หมวดหมู่</button></div>
    <div data-body></div>`;
  const body = $('[data-body]', root);
  let categories = [], groups = [], ingredients = [];

  async function load() {
    $$('[data-tab]', root).forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    [categories, groups, ingredients] = await Promise.all([api('/categories'), api('/option-groups'), api('/ingredients')]);
    if (tab === 'products') return listProducts();
    if (tab === 'groups') return listGroups();
    return listCategories();
  }

  // ---------- products ----------
  async function listProducts() {
    const products = await api('/products');
    body.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th></th><th>รหัส</th><th>ชื่อ</th><th>หมวด</th><th class="right">ราคา</th><th class="right">ต้นทุนสูตร</th><th class="right">GP%</th><th>ตัวเลือก</th><th>สถานะ</th></tr></thead><tbody>
      ${products.map((p) => {
        const cost = p.recipe.length ? p.recipe_cost : p.cost;
        const gp = p.price ? ((p.price - cost) / p.price * 100) : 0;
        return `<tr class="clickable ${p.active ? '' : 'dim'}" data-id="${p.id}"><td style="font-size:1.5rem">${esc(p.icon)}</td><td>${esc(p.sku || '')}</td><td><b>${esc(p.name)}</b><div class="small muted">${esc(p.description)}</div></td>
        <td>${esc(p.category_name || '')}</td><td class="right">${money(p.price)}</td><td class="right">${money(cost)}${p.recipe.length ? '' : ' <span class="badge">กำหนดเอง</span>'}</td>
        <td class="right"><span class="badge ${gp >= 60 ? 'ok' : gp >= 40 ? 'warn' : 'danger'}">${gp.toFixed(0)}%</span></td>
        <td class="small">${p.group_ids.map((g) => esc(groups.find((x) => x.id === g)?.name || '')).join(', ')}</td>
        <td>${p.active ? '<span class="badge ok">ขาย</span>' : '<span class="badge">ปิด</span>'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    $$('[data-id]', body).forEach((tr) => tr.onclick = () => editProduct(products.find((p) => p.id === Number(tr.dataset.id))));
  }

  function editProduct(p = null) {
    const recipe = p ? p.recipe.map((r) => ({ ingredient_id: r.ingredient_id, qty: r.qty })) : [];
    const f = h(`<div>
      <div class="form-grid">
        <label class="field"><span>ชื่อสินค้า</span><input name="name" value="${esc(p?.name || '')}"></label>
        <label class="field"><span>รหัส (SKU)</span><input name="sku" value="${esc(p?.sku || '')}"></label>
        <label class="field"><span>หมวดหมู่</span><select name="category_id">${categories.map((c) => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label class="field"><span>ราคาขาย (บาท)</span><input name="price" type="number" min="0" step="any" value="${p?.price ?? ''}"></label>
        <label class="field"><span>ต้นทุน (ใช้เมื่อไม่มีสูตร)</span><input name="cost" type="number" min="0" step="any" value="${p?.cost ?? 0}"></label>
        <label class="field"><span>ไอคอน (emoji)</span><input name="icon" value="${esc(p?.icon || '🍮')}"></label>
        <label class="field"><span>สีพื้น</span><input name="color" type="color" value="${esc(p?.color || '#f6d365')}"></label>
        <label class="field"><span>ลำดับ</span><input name="sort" type="number" value="${p?.sort ?? 0}"></label>
      </div>
      <label class="field"><span>คำอธิบาย</span><input name="description" value="${esc(p?.description || '')}"></label>
      <label class="chk"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}> เปิดขาย</label>
      <h3 style="margin-top:16px">กลุ่มตัวเลือก</h3>
      <div class="opt-list">${groups.map((g) => `<label class="opt chk"><input type="checkbox" data-grp="${g.id}" ${p?.group_ids.includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('')}</div>
      <h3 style="margin-top:16px">สูตร / วัตถุดิบที่ใช้ต่อ 1 หน่วย <span class="small muted">(ตัดสต็อกอัตโนมัติเมื่อขาย)</span></h3>
      <div data-recipe></div><button class="btn sm" data-addr>+ วัตถุดิบ</button>
      <div class="right" data-rcost style="margin-top:8px"></div>
    </div>`);
    const paintRecipe = () => {
      $('[data-recipe]', f).innerHTML = recipe.map((r, i) => `<div class="row" style="margin-bottom:6px">
        <select data-ri="${i}" style="flex:2">${ingredients.map((x) => `<option value="${x.id}" ${x.id === r.ingredient_id ? 'selected' : ''}>${esc(x.name)} (${esc(x.unit)})</option>`).join('')}</select>
        <input data-rq="${i}" type="number" min="0" step="any" value="${r.qty}" style="flex:1"><button class="btn sm" data-rd="${i}">✕</button></div>`).join('') || '<p class="small muted">ยังไม่มีสูตร</p>';
      const cost = recipe.reduce((s, r) => s + r.qty * (ingredients.find((x) => x.id === r.ingredient_id)?.cost_per_unit || 0), 0);
      $('[data-rcost]', f).innerHTML = `ต้นทุนวัตถุดิบตามสูตร: <b>${money(cost)}</b> บาท`;
      $$('[data-ri]', f).forEach((s) => s.onchange = () => { recipe[s.dataset.ri].ingredient_id = Number(s.value); paintRecipe(); });
      $$('[data-rq]', f).forEach((s) => s.onchange = () => { recipe[s.dataset.rq].qty = Number(s.value); paintRecipe(); });
      $$('[data-rd]', f).forEach((b) => b.onclick = () => { recipe.splice(Number(b.dataset.rd), 1); paintRecipe(); });
    };
    $('[data-addr]', f).onclick = () => { recipe.push({ ingredient_id: ingredients[0]?.id, qty: 1 }); paintRecipe(); };
    paintRecipe();
    const m = modal({ title: p ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า', body: f, wide: true, foot: '<button class="btn primary" data-save>บันทึก</button>' });
    $('[data-save]', m.el).onclick = action(async () => {
      const data = { ...formData(f), group_ids: $$('[data-grp]', f).filter((x) => x.checked).map((x) => Number(x.dataset.grp)), recipe };
      await api(p ? `/products/${p.id}` : '/products', { method: p ? 'PUT' : 'POST', body: data });
      m.close(); toast('บันทึกแล้ว', 'ok'); load();
    });
  }

  // ---------- option groups ----------
  function listGroups() {
    body.innerHTML = `<div class="grid cols-2">${groups.map((g) => `<div class="card clickable" data-id="${g.id}" style="cursor:pointer">
      <div class="row between"><h3 style="margin:0">${esc(g.name)}</h3><div>${g.required ? '<span class="badge danger">บังคับ</span>' : ''} ${g.multiple ? `<span class="badge info">หลายอย่าง${g.max_select ? ' ≤' + g.max_select : ''}</span>` : '<span class="badge">เลือก 1</span>'}</div></div>
      <div class="opt-list" style="margin-top:8px">${g.options.map((o) => `<span class="badge ${o.is_default ? 'brand' : ''}">${esc(o.name)}${o.price_delta ? ` ${o.price_delta > 0 ? '+' : ''}${o.price_delta}` : ''}${o.ingredient_name ? ` • ${esc(o.ingredient_name)} ${o.ingredient_qty}${esc(o.unit)}` : ''}</span>`).join('')}</div></div>`).join('')}</div>`;
    $$('[data-id]', body).forEach((c) => c.onclick = () => editGroup(groups.find((g) => g.id === Number(c.dataset.id))));
  }

  function editGroup(g = null) {
    const opts = g ? g.options.map((o) => ({ ...o })) : [{ name: '', price_delta: 0 }];
    const f = h(`<div><div class="form-grid">
      <label class="field"><span>ชื่อกลุ่ม</span><input name="name" value="${esc(g?.name || '')}"></label>
      <label class="field"><span>เลือกได้สูงสุด (0 = ไม่จำกัด)</span><input name="max_select" type="number" min="0" value="${g?.max_select ?? 0}"></label></div>
      <div class="row"><label class="chk"><input type="checkbox" name="required" ${g?.required ? 'checked' : ''}> บังคับเลือก</label>
      <label class="chk"><input type="checkbox" name="multiple" ${g?.multiple ? 'checked' : ''}> เลือกได้หลายอย่าง</label></div>
      <h3 style="margin-top:14px">ตัวเลือก</h3>
      <div class="small muted" style="margin-bottom:6px">ชื่อ • ราคาเพิ่ม • วัตถุดิบที่ใช้เพิ่ม (ถ้ามี) • ปริมาณ • ค่าเริ่มต้น</div>
      <div data-opts></div><button class="btn sm" data-addo>+ ตัวเลือก</button></div>`);
    const paint = () => {
      $('[data-opts]', f).innerHTML = opts.map((o, i) => `<div class="row" style="margin-bottom:6px">
        <input data-k="name" data-i="${i}" value="${esc(o.name)}" placeholder="ชื่อ" style="flex:2">
        <input data-k="price_delta" data-i="${i}" type="number" step="any" value="${o.price_delta}" style="flex:1">
        <select data-k="ingredient_id" data-i="${i}" style="flex:2"><option value="">— ไม่ตัดสต็อก —</option>${ingredients.map((x) => `<option value="${x.id}" ${x.id === o.ingredient_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <input data-k="ingredient_qty" data-i="${i}" type="number" min="0" step="any" value="${o.ingredient_qty || 0}" style="flex:1">
        <label class="chk"><input type="checkbox" data-k="is_default" data-i="${i}" ${o.is_default ? 'checked' : ''}>ค่าเริ่มต้น</label>
        <button class="btn sm" data-del="${i}">✕</button></div>`).join('');
      $$('[data-k]', f).forEach((inp) => inp.onchange = () => {
        const o = opts[inp.dataset.i];
        o[inp.dataset.k] = inp.type === 'checkbox' ? (inp.checked ? 1 : 0) : inp.dataset.k === 'name' ? inp.value : inp.value === '' ? null : Number(inp.value);
      });
      $$('[data-del]', f).forEach((b) => b.onclick = () => { opts.splice(Number(b.dataset.del), 1); paint(); });
    };
    $('[data-addo]', f).onclick = () => { opts.push({ name: '', price_delta: 0 }); paint(); };
    paint();
    const m = modal({ title: g ? 'แก้ไขกลุ่มตัวเลือก' : 'เพิ่มกลุ่มตัวเลือก', body: f, wide: true, foot: `${g ? '<button class="btn danger" data-del-g>ลบกลุ่ม</button><div class="grow"></div>' : ''}<button class="btn primary" data-save>บันทึก</button>` });
    $('[data-save]', m.el).onclick = action(async () => {
      await api(g ? `/option-groups/${g.id}` : '/option-groups', { method: g ? 'PUT' : 'POST', body: { ...formData(f), options: opts } });
      m.close(); toast('บันทึกแล้ว', 'ok'); load();
    });
    $('[data-del-g]', m.el)?.addEventListener('click', action(async () => {
      if (!confirm('ลบกลุ่มนี้? สินค้าที่ผูกไว้จะไม่มีตัวเลือกนี้อีก')) return;
      await api(`/option-groups/${g.id}`, { method: 'DELETE' }); m.close(); load();
    }));
  }

  // ---------- categories ----------
  function listCategories() {
    body.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th></th><th>ชื่อหมวด</th><th>ลำดับ</th><th>สินค้า</th><th>สถานะ</th></tr></thead><tbody>
      ${categories.map((c) => `<tr class="clickable ${c.active ? '' : 'dim'}" data-id="${c.id}"><td style="font-size:1.4rem">${esc(c.icon)}</td><td>${esc(c.name)}</td><td>${c.sort}</td><td>${c.product_count}</td><td>${c.active ? '<span class="badge ok">แสดง</span>' : '<span class="badge">ซ่อน</span>'}</td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-id]', body).forEach((tr) => tr.onclick = () => editCategory(categories.find((c) => c.id === Number(tr.dataset.id))));
  }
  function editCategory(c = null) {
    const f = h(`<div class="form-grid">
      <label class="field"><span>ชื่อหมวด</span><input name="name" value="${esc(c?.name || '')}"></label>
      <label class="field"><span>ไอคอน</span><input name="icon" value="${esc(c?.icon || '🍮')}"></label>
      <label class="field"><span>ลำดับ</span><input name="sort" type="number" value="${c?.sort ?? 0}"></label>
      <label class="chk"><input type="checkbox" name="active" ${!c || c.active ? 'checked' : ''}> แสดงในหน้าขาย</label></div>`);
    const m = modal({ title: c ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่', body: f, foot: '<button class="btn primary" data-save>บันทึก</button>' });
    $('[data-save]', m.el).onclick = action(async () => {
      await api(c ? `/categories/${c.id}` : '/categories', { method: c ? 'PUT' : 'POST', body: formData(f) });
      m.close(); toast('บันทึกแล้ว', 'ok'); load();
    });
  }

  $$('[data-tab]', root).forEach((b) => b.onclick = () => { tab = b.dataset.tab; load(); });
  $('[data-add]', root).onclick = () => (tab === 'products' ? editProduct() : tab === 'groups' ? editGroup() : editCategory());
  await load();
}

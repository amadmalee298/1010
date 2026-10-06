// หน้าขายหน้าร้าน (POS)
import { state, api, $, $$, esc, h, toast, modal, money, baht, LABELS, action, formData } from '../core.js';
import { printReceipt, printKitchen } from '../receipt.js';

const HOLD_KEY = 'pos_held_bills';
const emptyCart = () => ({ items: [], order_type: 'takeaway', table_no: '', member: null, promotion_id: null, promo_code: '', manual_discount: 0, redeem_points: 0, note: '' });

export async function renderPos(root) {
  const menu = await api('/menu');
  if (!root.isConnected) return; // ผู้ใช้เปลี่ยนหน้าไปแล้วระหว่างโหลด
  let cart = emptyCart();
  let quote = null;
  let category = 'all';
  let search = '';
  let quoteTimer = null;

  root.innerHTML = `<div class="pos">
    <section class="pos-menu">
      <div class="pos-top">
        <input type="search" placeholder="🔍 ค้นหาเมนู / รหัส" data-search style="max-width:320px">
        <div class="grow"></div>
        <button class="btn" data-held>📋 บิลที่พัก <span class="badge brand" data-held-count>0</span></button>
        <span class="badge ${state.shift ? 'ok' : 'danger'}" data-shift></span>
      </div>
      <div class="cats" data-cats></div>
      <div class="products" data-products></div>
    </section>
    <aside class="cart">
      <div class="cart-head">
        <div class="row between">
          <div class="seg" data-types>${Object.entries(LABELS.orderType).map(([k, v]) => `<button data-type="${k}">${v}</button>`).join('')}</div>
          <button class="btn sm ghost" data-clear title="ล้างตะกร้า">🗑️</button>
        </div>
        <div class="row" style="margin-top:8px">
          <input placeholder="โต๊ะ / ชื่อลูกค้า" data-table style="flex:1">
          <button class="btn" data-member>⭐ สมาชิก</button>
        </div>
        <div data-member-chip></div>
      </div>
      <div class="cart-items" data-items></div>
      <div class="cart-foot">
        <div data-sum></div>
        <div class="row" style="margin-top:10px">
          <button class="btn" data-discount>🏷️ ส่วนลด</button>
          <button class="btn" data-note>📝</button>
          <button class="btn" data-hold>⏸️ พัก</button>
          <button class="btn primary lg grow" data-pay>ชำระเงิน</button>
        </div>
      </div>
    </aside></div>`;

  const el = (k) => $(`[data-${k}]`, root);

  // ---------------- menu ----------------
  function renderCats() {
    const cats = [{ id: 'all', name: 'ทั้งหมด', icon: '✨' }, ...menu.categories];
    el('cats').innerHTML = cats.map((c) => `<button class="cat-btn ${String(c.id) === String(category) ? 'active' : ''}" data-cat="${c.id}">${c.icon || ''} ${esc(c.name)}</button>`).join('');
    $$('[data-cat]', root).forEach((b) => b.onclick = () => { category = b.dataset.cat; renderCats(); renderProducts(); });
  }
  function renderProducts() {
    const term = search.trim().toLowerCase();
    const list = menu.products.filter((p) => (category === 'all' || String(p.category_id) === String(category)) &&
      (!term || p.name.toLowerCase().includes(term) || (p.sku || '').toLowerCase().includes(term)));
    el('products').innerHTML = list.length ? list.map((p) => {
      const stockBadge = p.available === null ? '' : p.available <= 0 ? '<span class="badge danger stock">หมด</span>' : p.available <= 5 ? `<span class="badge warn stock">เหลือ ${p.available}</span>` : '';
      return `<button class="product ${p.available === 0 ? 'out' : ''}" data-pid="${p.id}">
        ${stockBadge}<div class="pic" style="background:${esc(p.color)}33">${esc(p.icon)}</div>
        <div class="info"><div class="name">${esc(p.name)}</div><div class="price">${baht(p.price)}${p.groups.length ? ' <span class="small muted">+ตัวเลือก</span>' : ''}</div></div></button>`;
    }).join('') : '<div class="muted">ไม่พบเมนู</div>';
    $$('[data-pid]', root).forEach((b) => b.onclick = () => pickProduct(menu.products.find((p) => p.id === Number(b.dataset.pid))));
  }
  el('search').oninput = (e) => { search = e.target.value; renderProducts(); };
  el('search').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const first = $('[data-pid]', root);
    if (first) { first.click(); e.target.select(); }
  };

  // ---------------- options ----------------
  function pickProduct(p, editIndex = null) {
    if (p.available === 0 && editIndex === null) toast(`⚠️ ${p.name} วัตถุดิบไม่พอตามสต็อก`, 'error');
    if (!p.groups.length && editIndex === null) return addItem(p, [], 1, '');
    const existing = editIndex !== null ? cart.items[editIndex] : null;
    const chosen = new Set(existing ? existing.option_ids : p.groups.flatMap((g) => g.options.filter((o) => o.is_default).map((o) => o.id)));
    let qty = existing ? existing.qty : 1;

    const body = h(`<div>
      <p class="muted">${esc(p.description || '')}</p>
      ${p.groups.map((g) => `<div class="opt-group"><div class="title">${esc(g.name)} ${g.required ? '<span class="badge danger">ต้องเลือก</span>' : '<span class="badge">ไม่บังคับ</span>'} ${g.multiple ? `<span class="small muted">เลือกได้${g.max_select ? ` สูงสุด ${g.max_select}` : 'หลายอย่าง'}</span>` : ''}</div>
        <div class="opt-list">${g.options.map((o) => `<button class="opt" data-g="${g.id}" data-o="${o.id}">${esc(o.name)}${o.price_delta ? ` <span class="small">${o.price_delta > 0 ? '+' : ''}${o.price_delta}</span>` : ''}</button>`).join('')}</div></div>`).join('')}
      <label class="field"><span>หมายเหตุถึงครัว</span><input data-inote placeholder="เช่น ไม่ใส่น้ำแข็ง" value="${esc(existing?.note || '')}"></label>
      <div class="row between"><div class="qty"><button data-dec>−</button><span data-q>${qty}</span><button data-inc>+</button></div>
      <div class="big-total" data-price style="font-size:1.5rem"></div></div></div>`);
    const m = modal({ title: `${p.icon} ${esc(p.name)}`, body, foot: `<button class="btn primary lg block" data-ok>${existing ? 'บันทึก' : 'เพิ่มลงตะกร้า'}</button>` });

    const unit = () => p.price + p.groups.flatMap((g) => g.options).filter((o) => chosen.has(o.id)).reduce((s, o) => s + o.price_delta, 0);
    const paint = () => {
      $$('.opt', body).forEach((b) => b.classList.toggle('on', chosen.has(Number(b.dataset.o))));
      $('[data-q]', body).textContent = qty;
      $('[data-price]', body).textContent = baht(unit() * qty);
    };
    $$('.opt', body).forEach((b) => b.onclick = () => {
      const g = p.groups.find((x) => x.id === Number(b.dataset.g));
      const id = Number(b.dataset.o);
      if (g.multiple) {
        if (chosen.has(id)) chosen.delete(id);
        else if (g.max_select && g.options.filter((o) => chosen.has(o.id)).length >= g.max_select) return toast(`เลือกได้สูงสุด ${g.max_select} อย่าง`, 'error');
        else chosen.add(id);
      } else {
        const was = chosen.has(id);
        g.options.forEach((o) => chosen.delete(o.id));
        if (!was || g.required) chosen.add(id);
      }
      paint();
    });
    $('[data-dec]', body).onclick = () => { qty = Math.max(1, qty - 1); paint(); };
    $('[data-inc]', body).onclick = () => { qty += 1; paint(); };
    $('[data-ok]', m.el).onclick = () => {
      const missing = p.groups.find((g) => g.required && !g.options.some((o) => chosen.has(o.id)));
      if (missing) return toast(`กรุณาเลือก "${missing.name}"`, 'error');
      const note = $('[data-inote]', body).value.trim();
      if (existing) {
        cart.items.splice(editIndex, 1);
      }
      addItem(p, [...chosen], qty, note);
      m.close();
    };
    paint();
  }

  function addItem(p, optionIds, qty, note) {
    const ids = [...optionIds].sort((a, b) => a - b);
    const key = `${p.id}|${ids.join(',')}|${note}`;
    const opts = p.groups.flatMap((g) => g.options).filter((o) => ids.includes(o.id));
    const same = cart.items.find((i) => i.key === key);
    if (same) same.qty += qty;
    else cart.items.push({ key, product_id: p.id, name: p.name, icon: p.icon, option_ids: ids, options: opts.map((o) => o.name), unit_price: p.price + opts.reduce((s, o) => s + o.price_delta, 0), qty, note });
    renderCart();
  }

  // ---------------- cart ----------------
  function renderCart() {
    $$('[data-type]', root).forEach((b) => b.classList.toggle('on', b.dataset.type === cart.order_type));
    el('table').value = cart.table_no;
    el('member-chip').innerHTML = cart.member
      ? `<div class="member-chip"><div>⭐ <b>${esc(cart.member.name)}</b> <span class="small muted">${esc(cart.member.phone)} • ${cart.member.points} แต้ม</span></div><button class="btn sm ghost" data-unmember>✕</button></div>` : '';
    $('[data-unmember]', root)?.addEventListener('click', () => { cart.member = null; cart.redeem_points = 0; const p = promoNeedsMember(); if (p) cart.promotion_id = null; renderCart(); });

    el('items').innerHTML = cart.items.length ? cart.items.map((i, idx) => `<div class="cart-item">
        <div data-edit="${idx}" style="cursor:pointer"><div><b>${esc(i.icon)} ${esc(i.name)}</b></div>
          ${i.options.length ? `<div class="opts">${esc(i.options.join(' • '))}</div>` : ''}${i.note ? `<div class="opts">📝 ${esc(i.note)}</div>` : ''}
          <div class="small muted">@ ${money(i.unit_price)}</div></div>
        <div class="right"><div class="num"><b>${money(i.unit_price * i.qty)}</b></div>
          <div class="qty" style="margin-top:6px"><button data-minus="${idx}">−</button><span>${i.qty}</span><button data-plus="${idx}">+</button></div></div>
      </div>`).join('') : '<div class="cart-empty"><div class="big">🍮</div>แตะเมนูเพื่อเพิ่มลงตะกร้า</div>';
    $$('[data-minus]', root).forEach((b) => b.onclick = () => { const i = cart.items[b.dataset.minus]; i.qty -= 1; if (i.qty <= 0) cart.items.splice(b.dataset.minus, 1); renderCart(); });
    $$('[data-plus]', root).forEach((b) => b.onclick = () => { cart.items[b.dataset.plus].qty += 1; renderCart(); });
    $$('[data-edit]', root).forEach((d) => d.onclick = () => {
      const item = cart.items[d.dataset.edit];
      const p = menu.products.find((x) => x.id === item.product_id);
      if (p) pickProduct(p, Number(d.dataset.edit));
    });
    refreshQuote();
  }
  const promoNeedsMember = () => cart.promotion_id && promotions.find((p) => p.id === cart.promotion_id)?.members_only;

  function cartPayload() {
    return {
      items: cart.items.map((i) => ({ product_id: i.product_id, qty: i.qty, option_ids: i.option_ids, note: i.note || undefined })),
      member_id: cart.member?.id, promotion_id: cart.promotion_id || undefined, promo_code: cart.promotion_id ? undefined : (cart.promo_code || undefined),
      manual_discount: cart.manual_discount || 0, redeem_points: cart.redeem_points || 0,
      order_type: cart.order_type, table_no: cart.table_no || undefined, note: cart.note || undefined
    };
  }

  function renderSum(errorMsg) {
    const local = cart.items.reduce((s, i) => s + i.unit_price * i.qty, 0);
    const qn = quote && !errorMsg ? quote : null;
    const count = cart.items.reduce((s, i) => s + i.qty, 0);
    el('sum').innerHTML = `
      <div class="sum-row"><span>รวม ${count} ชิ้น</span><span class="num">${money(qn ? qn.subtotal : local)}</span></div>
      ${qn && qn.promo_discount ? `<div class="sum-row disc"><span>🏷️ ${esc(qn.promotion?.name || 'โปรโมชั่น')}</span><span>-${money(qn.promo_discount)}</span></div>` : ''}
      ${qn && qn.manual_discount ? `<div class="sum-row disc"><span>ส่วนลดพิเศษ</span><span>-${money(qn.manual_discount)}</span></div>` : ''}
      ${qn && qn.points_discount ? `<div class="sum-row disc"><span>แลก ${qn.points_redeemed} แต้ม</span><span>-${money(qn.points_discount)}</span></div>` : ''}
      ${qn && qn.vat ? `<div class="sum-row small muted"><span>VAT ${state.settings.vat_rate}% ${qn.vat_inclusive ? '(รวมในราคา)' : ''}</span><span>${money(qn.vat)}</span></div>` : ''}
      ${errorMsg ? `<div class="badge danger" style="margin:4px 0">${esc(errorMsg)}</div>` : ''}
      <div class="sum-row total"><span>ยอดสุทธิ</span><span class="num">${baht(qn ? qn.total : local)}</span></div>
      ${qn && qn.points_earned ? `<div class="small muted right">จะได้รับ ${qn.points_earned} แต้ม</div>` : ''}
      ${cart.note ? `<div class="small muted">📝 ${esc(cart.note)}</div>` : ''}`;
    el('pay').disabled = !cart.items.length || !!errorMsg;
  }

  function refreshQuote() {
    clearTimeout(quoteTimer);
    if (!cart.items.length) { quote = null; return renderSum(); }
    renderSum();
    quoteTimer = setTimeout(async () => {
      try { quote = await api('/orders/quote', { method: 'POST', body: cartPayload() }); renderSum(); }
      catch (err) { quote = null; renderSum(err.message); }
    }, 200);
  }

  $$('[data-type]', root).forEach((b) => b.onclick = () => { cart.order_type = b.dataset.type; renderCart(); });
  el('table').oninput = (e) => { cart.table_no = e.target.value; };
  el('clear').onclick = () => { if (cart.items.length && !confirm('ล้างตะกร้าทั้งหมด?')) return; cart = emptyCart(); renderCart(); };
  el('note').onclick = () => {
    const m = modal({ title: 'หมายเหตุบิล', body: `<textarea rows="3" data-n>${esc(cart.note)}</textarea>`, foot: '<button class="btn primary" data-ok>บันทึก</button>' });
    $('[data-ok]', m.el).onclick = () => { cart.note = $('[data-n]', m.el).value.trim(); m.close(); renderCart(); };
  };

  // ---------------- member ----------------
  el('member').onclick = () => {
    const body = h(`<div>
      <div class="row"><input data-phone inputmode="numeric" placeholder="เบอร์โทรสมาชิก" class="grow" style="flex:1"><button class="btn primary" data-find>ค้นหา</button></div>
      <div data-result style="margin-top:12px"></div></div>`);
    const m = modal({ title: '⭐ สมาชิก', body });
    const find = action(async () => {
      const phone = $('[data-phone]', body).value.replace(/\D/g, '');
      if (!phone) return;
      try {
        const mem = await api('/members/lookup?phone=' + phone);
        cart.member = mem; m.close(); renderCart(); toast(`เลือกสมาชิก ${mem.name}`, 'ok');
      } catch {
        const r = $('[data-result]', body);
        r.innerHTML = `<div class="card"><p>ไม่พบเบอร์ <b>${esc(phone)}</b> — สมัครสมาชิกใหม่</p>
          <label class="field"><span>ชื่อ</span><input name="name"></label>
          <label class="field"><span>วันเกิด (ไม่บังคับ)</span><input name="birthday" type="date"></label>
          <button class="btn ok block" data-reg>สมัครและเลือก</button></div>`;
        $('[name=name]', r).focus();
        $('[data-reg]', r).onclick = action(async () => {
          const mem = await api('/members', { method: 'POST', body: { phone, ...formData(r) } });
          cart.member = mem; m.close(); renderCart(); toast('สมัครสมาชิกเรียบร้อย', 'ok');
        });
      }
    });
    $('[data-find]', body).onclick = find;
    $('[data-phone]', body).onkeydown = (e) => e.key === 'Enter' && find();
  };

  // ---------------- discount ----------------
  let promotions = [];
  api('/promotions?active=1').then((p) => { promotions = p; }).catch(() => {});
  el('discount').onclick = () => {
    const maxCashier = Number(state.settings.max_cashier_discount || 0);
    const body = h(`<div>
      <h3>โปรโมชั่น</h3>
      <div class="opt-list" style="margin-bottom:10px">
        <button class="opt ${!cart.promotion_id ? 'on' : ''}" data-promo="">ไม่ใช้</button>
        ${promotions.map((p) => `<button class="opt ${cart.promotion_id === p.id ? 'on' : ''}" data-promo="${p.id}">${esc(p.name)}${p.members_only ? ' ⭐' : ''}<div class="small muted">${p.type === 'percent' ? p.value + '%' : '฿' + p.value}${p.min_total ? ` • ขั้นต่ำ ${p.min_total}` : ''}</div></button>`).join('')}
      </div>
      <label class="field"><span>หรือกรอกโค้ดส่วนลด</span><input name="promo_code" value="${esc(cart.promo_code)}" placeholder="เช่น SAVE30" style="text-transform:uppercase"></label>
      <h3>ส่วนลดพิเศษ (บาท)</h3>
      <div class="row"><input name="manual_discount" type="number" min="0" step="1" value="${cart.manual_discount || ''}" style="flex:1">
        ${[5, 10, 20].map((v) => `<button class="btn sm" data-pct="${v}">${v}%</button>`).join('')}</div>
      ${state.user.role === 'cashier' ? `<div class="small muted">แคชเชียร์ลดได้ไม่เกิน ฿${maxCashier} — เกินกว่านี้ต้องใช้ PIN ผู้จัดการตอนชำระเงิน</div>` : ''}
      ${cart.member ? `<h3 style="margin-top:14px">แลกแต้ม (มี ${cart.member.points} แต้ม • ${state.settings.point_value} บาท/แต้ม)</h3>
        <div class="row"><input name="redeem_points" type="number" min="0" max="${cart.member.points}" value="${cart.redeem_points || ''}" style="flex:1"><button class="btn sm" data-allpts>ใช้ทั้งหมด</button></div>` : '<p class="small muted">เลือกสมาชิกเพื่อแลกแต้ม</p>'}
    </div>`);
    let promoId = cart.promotion_id;
    const m = modal({ title: '🏷️ ส่วนลด', body, foot: '<button class="btn primary" data-ok>ใช้ส่วนลด</button>' });
    $$('[data-promo]', body).forEach((b) => b.onclick = () => {
      promoId = b.dataset.promo ? Number(b.dataset.promo) : null;
      $$('[data-promo]', body).forEach((x) => x.classList.toggle('on', x === b));
    });
    $$('[data-pct]', body).forEach((b) => b.onclick = () => {
      const sub = cart.items.reduce((s, i) => s + i.unit_price * i.qty, 0);
      $('[name=manual_discount]', body).value = Math.round(sub * Number(b.dataset.pct) / 100);
    });
    $('[data-allpts]', body)?.addEventListener('click', () => {
      const sub = quote ? quote.total + (quote.points_discount || 0) : cart.items.reduce((s, i) => s + i.unit_price * i.qty, 0);
      const pv = Number(state.settings.point_value) || 1;
      $('[name=redeem_points]', body).value = Math.min(cart.member.points, Math.floor(sub / pv));
    });
    $('[data-ok]', m.el).onclick = () => {
      const f = formData(body);
      cart.promotion_id = promoId;
      cart.promo_code = promoId ? '' : (f.promo_code || '').trim().toUpperCase();
      cart.manual_discount = Number(f.manual_discount) || 0;
      cart.redeem_points = Number(f.redeem_points) || 0;
      m.close(); renderCart();
    };
  };

  // ---------------- hold bills ----------------
  const held = () => { try { return JSON.parse(localStorage.getItem(HOLD_KEY) || '[]'); } catch { return []; } };
  const saveHeld = (list) => { localStorage.setItem(HOLD_KEY, JSON.stringify(list)); el('held-count').textContent = list.length; };
  saveHeld(held());
  el('hold').onclick = () => {
    if (!cart.items.length) return toast('ตะกร้าว่าง', 'error');
    saveHeld([...held(), { at: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }), cart }]);
    cart = emptyCart(); renderCart(); toast('พักบิลแล้ว', 'ok');
  };
  el('held').onclick = () => {
    const list = held();
    const body = h(`<div>${list.length ? list.map((b, i) => `<div class="row between card" style="margin-bottom:8px;padding:10px">
      <div><b>${esc(b.cart.table_no || 'บิล #' + (i + 1))}</b> <span class="muted small">${b.at} • ${b.cart.items.reduce((s, x) => s + x.qty, 0)} ชิ้น</span>
      <div class="small muted">${esc(b.cart.items.map((x) => x.name).join(', '))}</div></div>
      <div class="row"><button class="btn sm primary" data-load="${i}">เรียกคืน</button><button class="btn sm" data-del="${i}">ลบ</button></div></div>`).join('') : '<p class="muted">ไม่มีบิลที่พักไว้</p>'}</div>`);
    const m = modal({ title: '📋 บิลที่พักไว้', body });
    $$('[data-load]', body).forEach((b) => b.onclick = () => {
      const l = held();
      if (cart.items.length) l.push({ at: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }), cart });
      cart = l.splice(Number(b.dataset.load), 1)[0].cart;
      saveHeld(l); m.close(); renderCart();
    });
    $$('[data-del]', body).forEach((b) => b.onclick = () => { const l = held(); l.splice(Number(b.dataset.del), 1); saveHeld(l); m.close(); el('held').click(); });
  };

  // ---------------- payment ----------------
  el('pay').onclick = () => {
    if (!state.shift) return openShiftPrompt();
    if (!quote) return toast('กำลังคำนวณยอด…', 'error');
    const total = quote.total;
    let method = 'cash';
    const body = h(`<div>
      <div class="big-total">${baht(total)}</div>
      <div class="pay-methods" style="margin-top:12px">${Object.keys(LABELS.pay).map((k) => `<button data-m="${k}"><span class="ico">${LABELS.payIcon[k]}</span>${LABELS.pay[k]}</button>`).join('')}</div>
      <div data-pane></div>
      <div data-mgr class="hidden"><label class="field"><span>🔐 PIN ผู้จัดการ (ส่วนลดเกินสิทธิ์แคชเชียร์)</span><input type="password" inputmode="numeric" name="manager_pin"></label></div>
    </div>`);
    const needMgr = state.user.role === 'cashier' && cart.manual_discount > Number(state.settings.max_cashier_discount || 0);
    $('[data-mgr]', body).classList.toggle('hidden', !needMgr);
    const m = modal({ title: 'ชำระเงิน', body, foot: '<button class="btn ok lg block" data-confirm>ยืนยันการชำระเงิน</button>' });
    const pane = $('[data-pane]', body);
    const confirmBtn = $('[data-confirm]', m.el);

    const quick = [...new Set([total, Math.ceil(total / 20) * 20, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500, 1000].filter((v) => v >= total))].slice(0, 4);
    function paint() {
      $$('[data-m]', body).forEach((b) => b.classList.toggle('on', b.dataset.m === method));
      if (method === 'cash') {
        pane.innerHTML = `<label class="field"><span>รับเงินมา</span><input type="number" inputmode="decimal" min="0" step="any" name="cash" style="font-size:1.4rem"></label>
          <div class="cash-quick">${quick.map((v) => `<button class="btn" data-cash="${v}">${money(v)}</button>`).join('')}</div>
          <div class="change-box" data-change>เงินทอน ฿0.00</div>`;
        const inp = $('[name=cash]', pane);
        const upd = () => {
          const c = Number(inp.value) - total;
          $('[data-change]', pane).textContent = Number(inp.value) ? (c >= 0 ? `เงินทอน ${baht(c)}` : `ขาดอีก ${baht(-c)}`) : 'เงินทอน ฿0.00';
          $('[data-change]', pane).style.background = c >= 0 || !inp.value ? '' : 'var(--danger-soft)';
          $('[data-change]', pane).style.color = c >= 0 || !inp.value ? '' : 'var(--danger)';
        };
        inp.oninput = upd;
        inp.onkeydown = (e) => e.key === 'Enter' && confirmBtn.click();
        $$('[data-cash]', pane).forEach((b) => b.onclick = () => { inp.value = b.dataset.cash; upd(); });
        setTimeout(() => inp.focus(), 30);
      } else if (method === 'promptpay') {
        pane.innerHTML = '<div class="qr-box"><div id="qr"></div><div class="small muted" data-pp></div></div>';
        api('/promptpay?amount=' + total).then((r) => {
          $('[data-pp]', pane).textContent = `พร้อมเพย์: ${r.promptpay_id} • ยอด ${baht(total)}`;
          if (window.qrcode) {
            const qr = window.qrcode(0, 'M');
            qr.addData(r.payload);
            qr.make();
            $('#qr', pane).innerHTML = qr.createSvgTag({ cellSize: 6, margin: 3 });
          } else $('#qr', pane).innerHTML = `<code style="word-break:break-all">${esc(r.payload)}</code>`;
        }).catch((e) => { pane.innerHTML = `<div class="badge danger">${esc(e.message)}</div>`; });
      } else {
        pane.innerHTML = `<p class="center muted">${method === 'card' ? 'รูดบัตร/แตะบัตรที่เครื่อง EDC แล้วกดยืนยัน' : 'ตรวจสอบสลิปการโอน/แอปเดลิเวอรี่ แล้วกดยืนยัน'}</p>`;
      }
    }
    $$('[data-m]', body).forEach((b) => b.onclick = () => { method = b.dataset.m; paint(); });
    paint();

    confirmBtn.onclick = action(async () => {
      const payload = { ...cartPayload(), payment_method: method };
      if (method === 'cash') {
        const cash = Number($('[name=cash]', pane).value || 0);
        payload.cash_received = cash || total;
      }
      if (needMgr) payload.manager_pin = $('[name=manager_pin]', body).value;
      const order = await api('/orders', { method: 'POST', body: payload });
      m.close();
      showSuccess(order);
      cart = emptyCart();
      renderCart();
      api('/menu').then((mm) => { menu.products = mm.products; renderProducts(); }).catch(() => {});
    });
  };

  function showSuccess(order) {
    const body = h(`<div class="center">
      <div style="font-size:3rem">✅</div><h2>ชำระเงินสำเร็จ</h2>
      <div class="muted">คิวที่</div><div style="font-size:3rem;font-weight:700;color:var(--accent)">${order.queue_no}</div>
      <div class="muted">${esc(order.order_no)} • ${LABELS.pay[order.payment_method]} ${baht(order.total)}</div>
      ${order.payment_method === 'cash' ? `<div class="change-box" style="margin-top:12px">เงินทอน ${baht(order.change_amount)}</div>` : ''}
      ${order.member_id ? `<p>⭐ ${esc(order.member_name)} ได้รับ ${order.points_earned} แต้ม (คงเหลือ ${order.member_points})</p>` : ''}
    </div>`);
    const m = modal({ title: 'เสร็จสิ้น', body, foot: '<button class="btn" data-r>🖨️ ใบเสร็จ</button><button class="btn" data-k>🧾 ใบสั่งครัว</button><button class="btn primary" data-n>บิลใหม่</button>' });
    $('[data-r]', m.el).onclick = () => printReceipt(order);
    $('[data-k]', m.el).onclick = () => printKitchen(order);
    $('[data-n]', m.el).onclick = () => { m.close(); el('search').focus(); };
  }

  // ---------------- shift ----------------
  function paintShift() {
    el('shift').textContent = state.shift ? `กะเปิดโดย ${state.shift.user_name}` : 'ยังไม่เปิดกะ';
    el('shift').className = `badge ${state.shift ? 'ok' : 'danger'}`;
  }
  function openShiftPrompt() {
    const body = h(`<div><p>ต้องเปิดกะก่อนเริ่มขาย ใส่จำนวนเงินทอนตั้งต้นในลิ้นชัก</p>
      <label class="field"><span>เงินทอนตั้งต้น (บาท)</span><input type="number" min="0" name="opening_cash" value="1000"></label></div>`);
    const m = modal({ title: '💰 เปิดกะ', body, foot: '<button class="btn primary" data-ok>เปิดกะ</button>' });
    $('[data-ok]', m.el).onclick = action(async () => {
      const res = await api('/shifts/open', { method: 'POST', body: formData(body) });
      state.shift = res.shift; paintShift(); m.close(); toast('เปิดกะเรียบร้อย', 'ok');
    });
  }

  renderCats();
  renderProducts();
  renderCart();
  paintShift();
  if (!state.shift) openShiftPrompt();
  setTimeout(() => el('search').focus(), 50);
  return () => clearTimeout(quoteTimer);
}

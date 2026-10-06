// ฟังก์ชันพื้นฐานที่ทุกหน้าใช้ร่วมกัน: API, state, UI helper
export const state = {
  token: localStorage.getItem('pos_token') || null,
  user: JSON.parse(localStorage.getItem('pos_user') || 'null'),
  settings: {},
  shift: null
};

export function setSession(token, user) {
  state.token = token;
  state.user = user;
  if (token) {
    localStorage.setItem('pos_token', token);
    localStorage.setItem('pos_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_user');
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) {
    setSession(null, null);
    location.hash = '#/login';
  }
  if (!res.ok) throw new Error(data.error || `เกิดข้อผิดพลาด (${res.status})`);
  return data;
}

// ---------- formatting ----------
const moneyFmt = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => moneyFmt.format(Number(n) || 0);
export const baht = (n) => '฿' + money(n);
export const numFmt = (n, d = 2) => new Intl.NumberFormat('th-TH', { maximumFractionDigits: d }).format(Number(n) || 0);
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const timeOf = (s) => (s || '').slice(11, 16);
export const thDate = (s) => {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) + (s.length > 10 ? ' ' + timeOf(s) : '');
};

export const LABELS = {
  role: { owner: 'เจ้าของร้าน', manager: 'ผู้จัดการ', cashier: 'แคชเชียร์', kitchen: 'ครัว' },
  roleIcon: { owner: '👑', manager: '🧑‍💼', cashier: '🧑‍🍳', kitchen: '👩‍🍳' },
  orderType: { dine_in: 'ทานที่ร้าน', takeaway: 'กลับบ้าน', delivery: 'เดลิเวอรี่' },
  pay: { cash: 'เงินสด', promptpay: 'พร้อมเพย์', card: 'บัตร', transfer: 'โอน/แอป' },
  payIcon: { cash: '💵', promptpay: '📱', card: '💳', transfer: '🏦' },
  status: { pending: 'รอทำ', preparing: 'กำลังทำ', ready: 'พร้อมเสิร์ฟ', served: 'เสิร์ฟแล้ว' },
  statusBadge: { pending: 'warn', preparing: 'info', ready: 'ok', served: '' },
  stock: { sale: 'ขาย', void: 'คืนจากยกเลิก', purchase: 'รับเข้า', adjust: 'ปรับยอด/นับ', waste: 'ของเสีย' }
};

export const can = (...roles) => !!state.user && roles.includes(state.user.role);

// ---------- DOM helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, type = '') {
  const el = h(`<div class="toast ${type}">${esc(msg)}</div>`);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 4000 : 2500);
}

/** แสดง modal — คืน { el, close } ; onClose ถูกเรียกเมื่อปิด */
export function modal({ title, body, foot = '', wide = false, onClose }) {
  const back = h(`<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}">
    <div class="modal-head"><h3>${title}</h3><button class="btn ghost sm" data-x>✕</button></div>
    <div class="modal-body"></div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div></div>`);
  const bodyEl = $('.modal-body', back);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $('[data-x]', back).onclick = close;
  document.body.append(back);
  setTimeout(() => $('input:not([type=checkbox]), select', back)?.focus(), 30);
  return { el: back, close };
}

export function confirmBox(message, { okText = 'ยืนยัน', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: 'ยืนยัน', body: `<p>${message}</p>`,
      foot: `<button class="btn" data-no>ยกเลิก</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${okText}</button>`,
      onClose: () => { if (!done) resolve(false); }
    });
    $('[data-no]', m.el).onclick = () => m.close();
    $('[data-yes]', m.el).onclick = () => { done = true; m.close(); resolve(true); };
  });
}

/** อ่านค่าจากฟอร์ม (input[name]) เป็น object */
export function formData(root) {
  const out = {};
  for (const el of $$('[name]', root)) {
    if (el.type === 'checkbox') out[el.name] = el.checked ? 1 : 0;
    else out[el.name] = el.value;
  }
  return out;
}

/** ห่อ async handler ให้แสดง error เป็น toast และกันกดซ้ำ */
export function action(fn) {
  return async function (e) {
    const btn = e?.currentTarget instanceof HTMLButtonElement ? e.currentTarget : null;
    if (btn) btn.disabled = true;
    try { await fn.call(this, e); } catch (err) { toast(err.message, 'error'); } finally { if (btn) btn.disabled = false; }
  };
}

export function printHtml(html) {
  const area = $('#print-area');
  area.innerHTML = html;
  setTimeout(() => { window.print(); }, 50);
}

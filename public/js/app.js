// จุดเริ่มของแอป: router + โครงหน้า + หน้าเข้าสู่ระบบ
import { state, api, setSession, $, $$, esc, h, toast, LABELS } from './core.js';
import { renderPos } from './pages/pos.js';
import { renderOrders } from './pages/orders.js';
import { renderKitchen, renderQueue } from './pages/kitchen.js';
import { renderProducts } from './pages/products.js';
import { renderInventory } from './pages/inventory.js';
import { renderMembers } from './pages/members.js';
import { renderPromotions } from './pages/promotions.js';
import { renderShift } from './pages/shift.js';
import { renderReports } from './pages/reports.js';
import { renderUsers, renderSettings } from './pages/admin.js';

const ALL = ['owner', 'manager', 'cashier', 'kitchen'];
const STAFF = ['owner', 'manager', 'cashier'];
const MGR = ['owner', 'manager'];

const PAGES = [
  { path: 'pos', label: 'ขาย', icon: '🛒', roles: STAFF, render: renderPos, flush: true },
  { path: 'orders', label: 'บิล', icon: '🧾', roles: STAFF, render: renderOrders },
  { path: 'kitchen', label: 'ครัว', icon: '👩‍🍳', roles: ALL, render: renderKitchen },
  { path: 'shift', label: 'กะ/ลิ้นชัก', icon: '💰', roles: STAFF, render: renderShift },
  { path: 'members', label: 'สมาชิก', icon: '⭐', roles: STAFF, render: renderMembers },
  { path: 'inventory', label: 'สต็อก', icon: '📦', roles: STAFF, render: renderInventory },
  { path: 'products', label: 'เมนู', icon: '🍮', roles: MGR, render: renderProducts },
  { path: 'promotions', label: 'โปรโมชั่น', icon: '🏷️', roles: STAFF, render: renderPromotions },
  { path: 'reports', label: 'รายงาน', icon: '📊', roles: MGR, render: renderReports },
  { path: 'users', label: 'พนักงาน', icon: '👥', roles: ['owner'], render: renderUsers },
  { path: 'settings', label: 'ตั้งค่า', icon: '⚙️', roles: ['owner'], render: renderSettings }
];

let cleanup = null;
let routeSeq = 0;

async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const seq = ++routeSeq;
  const path = location.hash.replace(/^#\/?/, '') || '';
  const app = $('#app');

  if (path === 'queue') { cleanup = renderQueue(app) || null; return; }
  if (!state.token || path === 'login') return renderLogin(app);

  try {
    const [me, settings] = await Promise.all([api('/me'), api('/settings')]);
    state.user = me.user; state.shift = me.shift; state.settings = settings;
  } catch { return; } // 401 → api() พาไปหน้า login แล้ว
  if (seq !== routeSeq) return; // มีการเปลี่ยนหน้าซ้อนระหว่างรอ

  const allowed = PAGES.filter((p) => p.roles.includes(state.user.role));
  const page = allowed.find((p) => p.path === path) || allowed[0];
  if (page.path !== path) { location.replace('#/' + page.path); return; }

  app.innerHTML = '';
  const shell = h(`<div class="shell">
    <nav class="nav">
      <div class="logo" title="${esc(state.settings.shop_name)}">🍮</div>
      ${allowed.map((p) => `<a href="#/${p.path}" class="${p === page ? 'active' : ''}"><span class="ico">${p.icon}</span>${p.label}</a>`).join('')}
      <a href="#/queue" target="_blank" rel="noopener"><span class="ico">📺</span>จอคิว</a>
      <div class="spacer"></div>
      <div class="who">${LABELS.roleIcon[state.user.role]}<br>${esc(state.user.name)}</div>
      <a href="#" data-logout><span class="ico">🚪</span>ออก</a>
    </nav>
    <main class="main ${page.flush ? 'flush' : ''}"></main></div>`);
  app.append(shell);
  $('[data-logout]', shell).onclick = async (e) => {
    e.preventDefault();
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setSession(null, null);
    location.hash = '#/login';
  };
  try {
    const dispose = (await page.render($('.main', shell))) || null;
    if (seq === routeSeq) cleanup = dispose; else dispose?.();
  } catch (err) {
    $('.main', shell).innerHTML = `<div class="card">⚠️ ${esc(err.message)}</div>`;
  }
}

async function renderLogin(app) {
  let users = [];
  try { users = await api('/auth/users'); } catch (err) { toast(err.message, 'error'); }
  let selected = null;
  let pin = '';
  app.innerHTML = '';
  const el = h(`<div class="login"><div class="box card">
    <div class="brand"><div class="big">🍮</div><h2>Custard POS</h2><div class="muted">เลือกผู้ใช้และใส่ PIN</div></div>
    <div class="user-grid">${users.map((u) => `<button class="user-card" data-id="${u.id}"><div class="avatar">${LABELS.roleIcon[u.role]}</div><div>${esc(u.name)}</div><div class="small muted">${LABELS.role[u.role]}</div></button>`).join('')}</div>
    <div class="pin-dots">${'<span></span>'.repeat(4)}</div>
    <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}<button data-k="c">ล้าง</button><button data-k="0">0</button><button data-k="ok" class="btn primary">เข้า</button></div>
    <p class="center"><a href="#/queue" target="_blank">📺 เปิดจอเรียกคิวลูกค้า</a></p>
  </div></div>`);
  app.append(el);

  const dots = () => $$('.pin-dots span', el).forEach((d, i) => d.classList.toggle('on', i < pin.length));
  const submit = async () => {
    if (!selected) return toast('กรุณาเลือกผู้ใช้', 'error');
    if (pin.length < 4) return toast('PIN อย่างน้อย 4 หลัก', 'error');
    try {
      const res = await api('/auth/login', { method: 'POST', body: { user_id: selected, pin } });
      setSession(res.token, res.user);
      toast(`สวัสดี ${res.user.name}`, 'ok');
      const target = res.user.role === 'kitchen' ? '#/kitchen' : '#/pos';
      if (location.hash === target) route(); else location.hash = target;
    } catch (err) { pin = ''; dots(); toast(err.message, 'error'); }
  };
  const press = (k) => {
    if (k === 'c') pin = '';
    else if (k === 'ok') return submit();
    else if (pin.length < 6) pin += k;
    dots();
    if (pin.length === 4 && selected) setTimeout(() => pin.length === 4 && submit(), 150);
  };
  $$('.user-card', el).forEach((b) => b.onclick = () => {
    selected = Number(b.dataset.id);
    $$('.user-card', el).forEach((x) => x.classList.toggle('sel', x === b));
    pin = ''; dots();
  });
  $$('.keypad button', el).forEach((b) => b.onclick = () => press(b.dataset.k));
  const onKey = (e) => {
    if (!document.body.contains(el)) return document.removeEventListener('keydown', onKey);
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') { pin = pin.slice(0, -1); dots(); }
    else if (e.key === 'Enter') submit();
  };
  document.addEventListener('keydown', onKey);
  if (users.length === 1) $('.user-card', el).click();
}

window.addEventListener('hashchange', route);
route();


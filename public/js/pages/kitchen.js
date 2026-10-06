// จอครัว (KDS) + จอเรียกคิวลูกค้า
import { api, $, $$, esc, h, LABELS, timeOf, toast } from '../core.js';

const NEXT = { pending: 'preparing', preparing: 'ready', ready: 'served' };
const NEXT_LABEL = { pending: '▶ เริ่มทำ', preparing: '✔ ทำเสร็จ', ready: '🛎️ เสิร์ฟแล้ว' };
const LATE_MIN = 10;

export async function renderKitchen(root) {
  let known = new Set();
  let first = true;
  root.innerHTML = `<div class="page-head"><h2>👩‍🍳 จอครัว</h2><div class="row"><label class="chk"><input type="checkbox" data-sound checked> เสียงแจ้งเตือน</label><span class="muted small" data-upd></span></div></div>
    <div class="kds">${['pending', 'preparing', 'ready'].map((s) => `<div class="kds-col"><h3>${LABELS.status[s]} <span class="badge ${LABELS.statusBadge[s]}" data-c="${s}">0</span></h3><div data-col="${s}"></div></div>`).join('')}</div>`;

  function beep() {
    if (!$('[data-sound]', root)?.checked) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = 0.15;
      o.start(); o.stop(ctx.currentTime + 0.25);
    } catch { /* ignore */ }
  }

  async function load() {
    let orders;
    try { orders = await api('/kitchen'); } catch (e) { return toast(e.message, 'error'); }
    const fresh = orders.filter((o) => !known.has(o.id));
    if (!first && fresh.length) beep();
    first = false;
    known = new Set(orders.map((o) => o.id));
    const now = Date.now();
    for (const s of ['pending', 'preparing', 'ready']) {
      const list = orders.filter((o) => o.status === s);
      $(`[data-c="${s}"]`, root).textContent = list.length;
      $(`[data-col="${s}"]`, root).innerHTML = list.map((o) => {
        const mins = Math.floor((now - new Date(o.created_at.replace(' ', 'T')).getTime()) / 60000);
        return `<div class="ticket ${s} ${s !== 'ready' && mins >= LATE_MIN ? 'late' : ''}">
          <div class="row between"><span class="q">#${o.queue_no}</span><span class="badge ${mins >= LATE_MIN ? 'danger' : ''}">${timeOf(o.created_at)} • ${mins} นาที</span></div>
          <div class="small muted">${LABELS.orderType[o.order_type]}${o.table_no ? ' • ' + esc(o.table_no) : ''}</div>
          <ul>${o.items.map((i) => `<li><b>${i.qty} × ${esc(i.name)}</b>${i.options.length ? `<div class="small">${esc(i.options.join(' • '))}</div>` : ''}${i.note ? `<div class="small" style="color:var(--danger)">📝 ${esc(i.note)}</div>` : ''}</li>`).join('')}</ul>
          ${o.note ? `<div class="small" style="color:var(--danger)">📝 ${esc(o.note)}</div>` : ''}
          <div class="row" style="margin-top:8px">${s !== 'pending' ? `<button class="btn sm" data-back="${o.id}" data-s="${s}">↩</button>` : ''}<button class="btn primary grow" data-next="${o.id}" data-s="${s}">${NEXT_LABEL[s]}</button></div>
        </div>`;
      }).join('') || '<div class="muted small center" style="padding:20px">ว่าง</div>';
    }
    $('[data-upd]', root).textContent = 'อัปเดต ' + new Date().toLocaleTimeString('th-TH');
    $$('[data-next]', root).forEach((b) => b.onclick = () => setStatus(b.dataset.next, NEXT[b.dataset.s]));
    $$('[data-back]', root).forEach((b) => b.onclick = () => setStatus(b.dataset.back, b.dataset.s === 'ready' ? 'preparing' : 'pending'));
  }
  async function setStatus(id, status) {
    try { await api(`/orders/${id}/status`, { method: 'PATCH', body: { status } }); load(); } catch (e) { toast(e.message, 'error'); }
  }
  await load();
  const timer = setInterval(load, 5000);
  return () => clearInterval(timer);
}

export function renderQueue(app) {
  app.innerHTML = '';
  const el = h(`<div class="queue-screen"><div class="row between"><h1 data-shop>🍮</h1><h2 data-clock></h2></div>
    <div class="cols"><div class="col"><h2>⏳ กำลังเตรียม</h2><div class="nums" data-prep></div></div>
    <div class="col ready"><h2>✅ เชิญรับที่เคาน์เตอร์</h2><div class="nums" data-ready></div></div></div></div>`);
  app.append(el);
  async function load() {
    try {
      const r = await fetch('/api/public/queue').then((x) => x.json());
      $('[data-shop]', el).textContent = '🍮 ' + (r.shop_name || '');
      $('[data-prep]', el).innerHTML = r.preparing.map((n) => `<div class="n">${n}</div>`).join('');
      $('[data-ready]', el).innerHTML = r.ready.map((n) => `<div class="n">${n}</div>`).join('');
    } catch { /* offline: ลองใหม่รอบหน้า */ }
    $('[data-clock]', el).textContent = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }
  load();
  const t = setInterval(load, 4000);
  return () => clearInterval(t);
}

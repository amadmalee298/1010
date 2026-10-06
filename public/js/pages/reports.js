// รายงานยอดขาย / กำไร / สินค้าขายดี
import { api, $, $$, esc, money, baht, LABELS, today, toast, state } from '../core.js';

function shift(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function renderReports(root) {
  let from = today(), to = today();
  root.innerHTML = `<div class="page-head"><h2>📊 รายงาน</h2><div class="row">
    <div class="tabs" style="margin:0"><button data-r="0">วันนี้</button><button data-r="1">เมื่อวาน</button><button data-r="7">7 วัน</button><button data-r="30">30 วัน</button><button data-r="m">เดือนนี้</button></div>
    <input type="date" data-from><span>ถึง</span><input type="date" data-to><button class="btn" data-csv>⬇️ CSV</button></div></div><div data-body></div>`;
  const body = $('[data-body]', root);

  async function load() {
    $('[data-from]', root).value = from; $('[data-to]', root).value = to;
    let r;
    try { r = await api(`/reports/summary?from=${from}&to=${to}`); } catch (e) { return toast(e.message, 'error'); }
    const k = r.kpi;
    const hours = Array.from({ length: 24 }, (_, h) => r.by_hour.find((x) => x.hour === h) || { hour: h, total: 0, count: 0 }).filter((x) => x.hour >= 7 && x.hour <= 22 || x.total);
    const maxH = Math.max(1, ...hours.map((x) => x.total));
    const maxP = Math.max(1, ...r.top_products.map((x) => x.qty));
    const maxD = Math.max(1, ...r.by_day.map((x) => x.total));
    const sumPay = r.by_payment.reduce((s, x) => s + x.total, 0) || 1;
    body.innerHTML = `
      <div class="grid kpi">
        ${[['ยอดขายสุทธิ', baht(k.net)], ['จำนวนบิล', k.orders], ['เฉลี่ย/บิล', baht(k.avg_ticket)], ['ส่วนลดรวม', baht(k.discounts)],
          ['ต้นทุนวัตถุดิบ', baht(k.cost)], ['กำไรขั้นต้น', baht(k.profit)], ['ลูกค้าสมาชิก', k.members], ['บิลยกเลิก', `${k.voids.count} (${money(k.voids.total)})`]]
          .map(([l, v]) => `<div class="card kpi-card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('')}
      </div>
      <div class="grid cols-2" style="margin-top:14px">
        <div class="card"><h3>ยอดขายรายชั่วโมง</h3>
          <div class="bars">${hours.map((x) => `<div class="bar" style="height:${x.total / maxH * 100}%" title="${x.hour}:00 • ${x.count} บิล • ${money(x.total)}"></div>`).join('')}</div>
          <div class="bars-x">${hours.map((x) => `<span>${x.hour}</span>`).join('')}</div></div>
        <div class="card"><h3>สินค้าขายดี</h3>${r.top_products.map((p, i) => `<div style="margin-bottom:8px"><div class="sum-row"><span>${i + 1}. ${esc(p.name)}</span><span><b>${p.qty}</b> ชิ้น • ${money(p.revenue)}</span></div><div class="hbar"><div style="width:${p.qty / maxP * 100}%"></div></div></div>`).join('') || '<p class="muted">ไม่มีข้อมูล</p>'}</div>
        <div class="card"><h3>ช่องทางชำระเงิน</h3>${r.by_payment.map((p) => `<div style="margin-bottom:8px"><div class="sum-row"><span>${LABELS.payIcon[p.payment_method]} ${LABELS.pay[p.payment_method]} (${p.count})</span><span>${money(p.total)} • ${(p.total / sumPay * 100).toFixed(0)}%</span></div><div class="hbar"><div style="width:${p.total / sumPay * 100}%"></div></div></div>`).join('') || '<p class="muted">ไม่มีข้อมูล</p>'}
          <h3 style="margin-top:14px">ประเภทออเดอร์</h3>${r.by_type.map((t) => `<div class="sum-row"><span>${LABELS.orderType[t.order_type]} (${t.count})</span><b>${money(t.total)}</b></div>`).join('') || '<p class="muted">-</p>'}</div>
        <div class="card"><h3>ตามหมวดหมู่</h3>${r.by_category.map((c) => `<div class="sum-row"><span>${esc(c.category)} (${c.qty})</span><b>${money(c.revenue)}</b></div>`).join('') || '<p class="muted">-</p>'}
          <h3 style="margin-top:14px">ตามพนักงาน</h3>${r.by_staff.map((s) => `<div class="sum-row"><span>${esc(s.name)} (${s.count} บิล)</span><b>${money(s.total)}</b></div>`).join('') || '<p class="muted">-</p>'}</div>
        ${r.by_day.length > 1 ? `<div class="card"><h3>ยอดขายรายวัน</h3>${r.by_day.map((d) => `<div style="margin-bottom:6px"><div class="sum-row small"><span>${d.day}</span><span>${d.count} บิล • ${money(d.total)} • กำไร ${money(d.total - d.cost)}</span></div><div class="hbar"><div style="width:${d.total / maxD * 100}%"></div></div></div>`).join('')}</div>` : ''}
        <div class="card"><h3>⚠️ วัตถุดิบใกล้หมด</h3>${r.low_stock.map((i) => `<div class="sum-row"><span>${esc(i.name)}</span><span class="badge danger">${i.stock} / ${i.min_stock} ${esc(i.unit)}</span></div>`).join('') || '<p class="muted">สต็อกปกติทั้งหมด 👍</p>'}</div>
      </div>`;
  }

  $$('[data-r]', root).forEach((b) => b.onclick = () => {
    const t = today(), v = b.dataset.r;
    if (v === '0') { from = to = t; }
    else if (v === '1') { from = to = shift(t, -1); }
    else if (v === 'm') { from = t.slice(0, 8) + '01'; to = t; }
    else { from = shift(t, -(Number(v) - 1)); to = t; }
    $$('[data-r]', root).forEach((x) => x.classList.toggle('on', x === b));
    load();
  });
  $('[data-from]', root).onchange = (e) => { from = e.target.value; load(); };
  $('[data-to]', root).onchange = (e) => { to = e.target.value; load(); };
  $('[data-csv]', root).onclick = () => { window.location = `/api/reports/export.csv?from=${from}&to=${to}&token=${state.token}`; };
  $('[data-r="0"]', root).classList.add('on');
  await load();
}

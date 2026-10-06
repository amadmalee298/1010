'use strict';
// ทดสอบ API ทั้งระบบด้วยฐานข้อมูลในหน่วยความจำ
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../server/db');
const { createServer } = require('../server/index');

let server, base, db;
async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
const login = async (user_id, pin) => (await call('/api/auth/login', { method: 'POST', body: { user_id, pin } })).data.token;
const optId = (name) => db.prepare('SELECT id FROM options WHERE name = ?').get(name).id;
const prodId = (sku) => db.prepare('SELECT id FROM products WHERE sku = ?').get(sku).id;
const stockOf = (name) => db.prepare('SELECT stock FROM ingredients WHERE name = ?').get(name).stock;

test.before(async () => {
  db = open(':memory:');
  server = createServer(db);
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('login / สิทธิ์ตามตำแหน่ง', async () => {
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { user_id: 3, pin: '0000' } })).status, 401);
  const cashier = await login(3, '1111');
  assert.ok(cashier);
  assert.equal((await call('/api/menu')).status, 401);
  assert.equal((await call('/api/menu', { token: cashier })).status, 200);
  assert.equal((await call('/api/reports/summary', { token: cashier })).status, 403);
  assert.equal((await call('/api/users', { token: await login(2, '2222') })).status, 403);
  const kitchen = await login(4, '3333');
  assert.equal((await call('/api/orders', { method: 'POST', token: kitchen, body: {} })).status, 403);
  assert.equal((await call('/api/kitchen', { token: kitchen })).status, 200);
});

test('ขายครบวงจร: เปิดกะ → ขาย → ตัดสต็อก → แต้ม → ครัว → ยกเลิก → ปิดกะ', async () => {
  const t = await login(3, '1111');
  const items = [{ product_id: prodId('C03'), qty: 2, option_ids: [optId('ใบเตย'), optId('หวานน้อย'), optId('วิปครีม')] }, { product_id: prodId('T01'), qty: 1 }];

  // ยังไม่เปิดกะ
  let r = await call('/api/orders', { method: 'POST', token: t, body: { items, payment_method: 'cash', cash_received: 500 } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /เปิดกะ/);

  r = await call('/api/shifts/open', { method: 'POST', token: t, body: { opening_cash: 1000 } });
  assert.equal(r.status, 200);

  const eggBefore = stockOf('ไข่ไก่');
  const creamBefore = stockOf('วิปครีม');
  const memberBefore = db.prepare('SELECT * FROM members WHERE id = 1').get();

  r = await call('/api/orders/quote', { method: 'POST', token: t, body: { items, member_id: 1 } });
  assert.equal(r.data.subtotal, 45 * 2 + 25);

  r = await call('/api/orders', { method: 'POST', token: t, body: { items, member_id: 1, redeem_points: 15, payment_method: 'cash', cash_received: 200 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const order = r.data;
  assert.equal(order.total, 100);
  assert.equal(order.change_amount, 100);
  assert.equal(order.points_earned, 4);
  assert.equal(order.queue_no, 1);
  assert.equal(order.items.length, 2);
  assert.ok(order.cost > 0);
  assert.equal(stockOf('ไข่ไก่'), eggBefore - 2 - 0.5);
  assert.equal(stockOf('วิปครีม'), creamBefore - 40);
  const memberAfter = db.prepare('SELECT * FROM members WHERE id = 1').get();
  assert.equal(memberAfter.points, memberBefore.points - 15 + 4);

  // ครัว
  r = await call('/api/kitchen', { token: await login(4, '3333') });
  assert.equal(r.data.length, 1);
  r = await call(`/api/orders/${order.id}/status`, { method: 'PATCH', token: t, body: { status: 'ready' } });
  assert.equal(r.status, 200);
  r = await call('/api/public/queue');
  assert.deepEqual(r.data.ready, [1]);

  // ยกเลิก: แคชเชียร์ต้องใช้ PIN ผู้จัดการ
  r = await call(`/api/orders/${order.id}/void`, { method: 'POST', token: t, body: { reason: 'ทดสอบ' } });
  assert.equal(r.status, 403);
  r = await call(`/api/orders/${order.id}/void`, { method: 'POST', token: t, body: { reason: 'ทดสอบ', manager_pin: '2222' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.payment_status, 'void');
  assert.equal(stockOf('ไข่ไก่'), eggBefore);
  assert.equal(stockOf('วิปครีม'), creamBefore);
  assert.equal(db.prepare('SELECT points FROM members WHERE id = 1').get().points, memberBefore.points);

  // บิลเงินโอน + ส่วนลดเกินสิทธิ์
  r = await call('/api/orders', { method: 'POST', token: t, body: { items: [{ product_id: prodId('C02'), qty: 1 }], manual_discount: 100, payment_method: 'transfer' } });
  assert.equal(r.status, 403);
  r = await call('/api/orders', { method: 'POST', token: t, body: { items: [{ product_id: prodId('C02'), qty: 1 }], manual_discount: 100, manager_pin: '1234', payment_method: 'transfer' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.total, 220);
  assert.equal(r.data.queue_no, 2);

  // บิลเงินสดเพื่อเช็คลิ้นชัก
  await call('/api/orders', { method: 'POST', token: t, body: { items: [{ product_id: prodId('T01'), qty: 2 }], payment_method: 'cash', cash_received: 100 } });
  await call('/api/shifts/cash', { method: 'POST', token: t, body: { type: 'out', amount: 30, reason: 'ซื้อน้ำแข็ง' } });
  r = await call('/api/shifts/close', { method: 'POST', token: t, body: { counted_cash: 1020 } });
  assert.equal(r.status, 200);
  assert.equal(r.data.expected_cash, 1000 + 50 - 30);
  assert.equal(r.data.difference, 0);

  // รายงาน
  const owner = await login(1, '1234');
  r = await call('/api/reports/summary', { token: owner });
  assert.equal(r.data.kpi.orders, 2);
  assert.equal(r.data.kpi.net, 270);
  assert.equal(r.data.kpi.voids.count, 1);
  r = await call('/api/reports/export.csv?token=' + owner);
  assert.equal(r.status, 200);
  assert.match(r.data, /order_no,created_at/);
});

test('สต็อก: รับเข้า / ของเสีย / นับ', async () => {
  const mgr = await login(2, '2222');
  const id = db.prepare("SELECT id FROM ingredients WHERE name = 'ไข่ไก่'").get().id;
  const start = stockOf('ไข่ไก่');
  await call(`/api/ingredients/${id}/adjust`, { method: 'POST', token: mgr, body: { reason: 'purchase', qty: 30, cost_per_unit: 4.5 } });
  assert.equal(stockOf('ไข่ไก่'), start + 30);
  await call(`/api/ingredients/${id}/adjust`, { method: 'POST', token: mgr, body: { reason: 'waste', qty: 2 } });
  assert.equal(stockOf('ไข่ไก่'), start + 28);
  await call(`/api/ingredients/${id}/adjust`, { method: 'POST', token: mgr, body: { reason: 'adjust', qty: 100 } });
  assert.equal(stockOf('ไข่ไก่'), 100);
  const cashier = await login(3, '1111');
  assert.equal((await call(`/api/ingredients/${id}/adjust`, { method: 'POST', token: cashier, body: { reason: 'adjust', qty: 1 } })).status, 403);
  const moves = (await call('/api/stock-movements?ingredient_id=' + id, { token: mgr })).data;
  assert.equal(moves[0].reason, 'adjust');
});

test('จัดการเมนู: สร้างสินค้าพร้อมสูตรและตัวเลือก', async () => {
  const mgr = await login(2, '2222');
  const groupId = db.prepare("SELECT id FROM option_groups WHERE name = 'ท็อปปิ้ง'").get().id;
  const ingId = db.prepare("SELECT id FROM ingredients WHERE name = 'นมสด'").get().id;
  const r = await call('/api/products', { method: 'POST', token: mgr, body: { name: 'คัสตาร์ดมะพร้าว', category_id: 1, price: 55, group_ids: [groupId], recipe: [{ ingredient_id: ingId, qty: 100 }] } });
  assert.equal(r.status, 200);
  const menu = (await call('/api/menu', { token: mgr })).data;
  const p = menu.products.find((x) => x.name === 'คัสตาร์ดมะพร้าว');
  assert.equal(p.groups.length, 1);
  assert.ok(p.available > 0);
  assert.equal((await call('/api/members', { method: 'POST', token: mgr, body: { phone: '0891112222', name: 'ซ้ำ' } })).status, 409);
});

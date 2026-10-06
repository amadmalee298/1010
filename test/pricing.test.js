'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { priceItem, calculateTotals, calculateChange } = require('../server/pricing');
const { promptPayPayload, crc16 } = require('../server/promptpay');

const settings = { vat_enabled: '0', vat_rate: '7', vat_inclusive: '1', baht_per_point: '25', point_value: '1', min_redeem_points: '10' };
const groups = [
  { id: 1, name: 'รส', required: true, multiple: false, max_select: 1, options: [{ id: 11, name: 'ใบเตย', price_delta: 0 }, { id: 12, name: 'ชาไทย', price_delta: 5 }] },
  { id: 2, name: 'ท็อปปิ้ง', required: false, multiple: true, max_select: 2, options: [{ id: 21, name: 'วิป', price_delta: 10 }, { id: 22, name: 'ไข่มุก', price_delta: 10 }, { id: 23, name: 'ถั่ว', price_delta: 10 }] }
];

test('priceItem: บวกราคาตัวเลือก', () => {
  const r = priceItem({ name: 'สังขยา', price: 35 }, groups, [12, 21]);
  assert.equal(r.unit_price, 50);
  assert.deepEqual(r.options.map((o) => o.name), ['ชาไทย', 'วิป']);
});

test('priceItem: ตรวจกฎตัวเลือก', () => {
  const p = { name: 'สังขยา', price: 35 };
  assert.throws(() => priceItem(p, groups, []), /กรุณาเลือก/);
  assert.throws(() => priceItem(p, groups, [11, 12]), /เลือกได้ 1/);
  assert.throws(() => priceItem(p, groups, [11, 21, 22, 23]), /ไม่เกิน 2/);
  assert.throws(() => priceItem(p, groups, [11, 999]), /ไม่ถูกต้อง/);
});

test('calculateTotals: โปร % + เพดาน + แลกแต้ม + แต้มที่ได้', () => {
  const t = calculateTotals({
    lines: [{ unit_price: 100, qty: 3 }],
    promotion: { active: 1, type: 'percent', value: 20, min_total: 0, max_discount: 50, members_only: 1 },
    member: { points: 40 }, redeemPoints: 20, settings, today: '2026-01-01'
  });
  assert.equal(t.subtotal, 300);
  assert.equal(t.promo_discount, 50);
  assert.equal(t.points_discount, 20);
  assert.equal(t.total, 230);
  assert.equal(t.points_earned, 9);
});

test('calculateTotals: เงื่อนไขโปรโมชั่น', () => {
  const lines = [{ unit_price: 50, qty: 1 }];
  assert.throws(() => calculateTotals({ lines, promotion: { active: 1, type: 'amount', value: 30, min_total: 300 }, settings }), /ยอดขั้นต่ำ/);
  assert.throws(() => calculateTotals({ lines, promotion: { active: 1, type: 'amount', value: 5, min_total: 0, members_only: 1 }, settings }), /สมาชิก/);
  assert.throws(() => calculateTotals({ lines, promotion: { active: 1, type: 'amount', value: 5, min_total: 0, end_date: '2025-12-31' }, settings, today: '2026-01-01' }), /หมดอายุ/);
  assert.throws(() => calculateTotals({ lines, redeemPoints: 5, member: { points: 100 }, settings }), /ขั้นต่ำ/);
  assert.throws(() => calculateTotals({ lines, redeemPoints: 20, member: { points: 10 }, settings }), /แต้มไม่พอ/);
  assert.throws(() => calculateTotals({ lines, manualDiscount: 60, settings }), /มากกว่ายอด/);
});

test('calculateTotals: VAT รวมใน / แยกนอก', () => {
  const lines = [{ unit_price: 107, qty: 1 }];
  const inc = calculateTotals({ lines, settings: { ...settings, vat_enabled: '1' } });
  assert.equal(inc.total, 107);
  assert.equal(inc.vat, 7);
  const exc = calculateTotals({ lines: [{ unit_price: 100, qty: 1 }], settings: { ...settings, vat_enabled: '1', vat_inclusive: '0' } });
  assert.equal(exc.vat, 7);
  assert.equal(exc.total, 107);
});

test('calculateChange', () => {
  assert.deepEqual(calculateChange(138.5, 'cash', 500), { cash_received: 500, change_amount: 361.5 });
  assert.deepEqual(calculateChange(50, 'promptpay'), { cash_received: 50, change_amount: 0 });
  assert.throws(() => calculateChange(100, 'cash', 50), /ไม่พอ/);
});

test('PromptPay: CRC16-CCITT และโครงสร้าง payload', () => {
  assert.equal(crc16('123456789'), '29B1');
  const p = promptPayPayload('081-234-5678', 45);
  assert.match(p, /^000201010212/);
  assert.ok(p.includes('0113' + '0066812345678'));
  assert.ok(p.includes('540545.00'));
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
  assert.ok(promptPayPayload('1234567890123').includes('02131234567890123'));
  assert.throws(() => promptPayPayload('123'), /ไม่ถูกต้อง/);
});

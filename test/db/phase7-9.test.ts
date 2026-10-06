import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { openSession, seedShop, stockOf } from './fixtures';

describe.skipIf(!hasDb)('Phase 7: batch production', () => {
  let db: TestDb;
  let manager: string, cashier: string, owner: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER');
    manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER');
    shop = await seedShop(db, manager);
    // Tart (finished good): 12 per batch from 12 eggs + 600 ml milk → batch cost 48 + 30 = 78
    await db.as(manager, `select public.save_recipe($1, 'tart', 12, 'ชิ้น', 1, $2::jsonb)`,
      [shop.tart, JSON.stringify([{ ingredient_id: shop.egg, quantity: 12 }, { ingredient_id: shop.milk, quantity: 600 }])]);
  });
  afterAll(() => db?.destroy());

  it('plans production with ingredient requirements scaled by batches', async () => {
    const { id } = await db.asOne<{ id: string }>(manager, `select public.create_production($1, 10, 'เช้า') as id`, [shop.tart]);
    const p = await db.adminOne<{ planned_output: string; status: string; production_number: string }>(`select * from public.production where id = $1`, [id]);
    expect(Number(p.planned_output)).toBe(120);
    expect(p.status).toBe('PLANNED');
    expect(p.production_number).toMatch(/^PD\d{6}-0001$/);
    const req = await db.as<{ name_th: string; required_quantity: string; shortage: string }>(manager, `select * from public.production_requirements($1)`, [id]);
    expect(req.map((r) => [r.name_th, Number(r.required_quantity), Number(r.shortage)]).sort()).toEqual([['นมสด', 6000, 0], ['ไข่ไก่', 120, 20]]);
  });

  it('refuses to complete when any ingredient is short, reporting all shortages and changing nothing', async () => {
    const plan = await db.adminOne<{ id: string }>(`select id from public.production where status = 'PLANNED' limit 1`);
    const eggs = await stockOf(db, shop.egg);
    await expect(db.as(manager, `select public.complete_production($1)`, [plan.id])).rejects.toThrow(/INSUFFICIENT_STOCK/);
    try { await db.as(manager, `select public.complete_production($1)`, [plan.id]); } catch (e) { expect((e as { detail?: string }).detail).toMatch(/ไข่ไก่: มี 100 ต้องใช้ 120/); }
    expect(await stockOf(db, shop.egg)).toBe(eggs);
    expect((await db.adminOne<{ status: string }>(`select status from public.production where id = $1`, [plan.id])).status).toBe('PLANNED');
    await db.as(manager, `select public.cancel_production($1)`, [plan.id]);
  });

  it('completes production: raw materials decrease, finished goods increase at actual cost', async () => {
    const { id } = await db.asOne<{ id: string }>(manager, `select public.create_production($1, 2) as id`, [shop.tart]);
    const eggs = await stockOf(db, shop.egg);
    const done = await db.asOne<{ status: string; total_cost: string; unit_cost: string; actual_output: string }>(
      manager, `select * from public.complete_production($1, 23)`, [id]); // one tart broke: 23 instead of 24
    expect(done.status).toBe('COMPLETED');
    expect(Number(done.total_cost)).toBe(156);           // 2 × 78
    expect(Number(done.unit_cost)).toBeCloseTo(6.7826, 4); // 156 / 23
    expect(await stockOf(db, shop.egg)).toBe(eggs - 24);
    expect(await stockOf(db, shop.tartItem)).toBe(23);
    const fg = await db.adminOne<{ avg_cost: string }>(`select avg_cost from public.ingredients where id = $1`, [shop.tartItem]);
    expect(Number(fg.avg_cost)).toBeCloseTo(6.7826, 4);
    await expect(db.as(manager, `select public.complete_production($1)`, [id])).rejects.toThrow(/INVALID_STATE/);
    await expect(db.as(cashier, `select public.create_production($1, 1)`, [shop.tart])).rejects.toThrow(/permission denied/);
  });

  it('sells produced goods at their production cost', async () => {
    await openSession(db, cashier);
    const o = await db.asOne<{ o: { cogs_total: number } }>(cashier, `select public.create_order($1::jsonb) as o`,
      [JSON.stringify({ items: [{ product_id: shop.tart, quantity: 2 }], payments: [{ method: 'CASH', amount: 50 }] })]);
    expect(o.o.cogs_total).toBeCloseTo(13.57, 2);
    expect(await stockOf(db, shop.tartItem)).toBe(21);
  });

  it('deducts produced pieces per pack for finished goods sold in boxes', async () => {
    const box = await db.asOne<{ id: string }>(manager, `insert into public.products (name_th, price, inventory_mode) values ('ทาร์ตกล่อง 6', 135, 'FINISHED_GOOD') returning id`);
    await db.as(manager, `select public.save_recipe($1, 'box', 12, 'ชิ้น', 6, $2::jsonb)`,
      [box.id, JSON.stringify([{ ingredient_id: shop.egg, quantity: 12 }, { ingredient_id: shop.milk, quantity: 600 }])]);
    const { id } = await db.asOne<{ id: string }>(manager, `select public.create_production($1, 1) as id`, [box.id]);
    await db.as(manager, `select public.complete_production($1)`, [id]);   // 12 pieces at 6.50 each
    const item = await db.adminOne<{ id: string }>(`select id from public.ingredients where product_id = $1`, [box.id]);
    const avail = await db.asOne<{ available: number }>(cashier, `select available from public.product_availability where product_id = $1`, [box.id]);
    expect(avail.available).toBe(2);
    const o = await db.asOne<{ o: { cogs_total: number } }>(cashier, `select public.create_order($1::jsonb) as o`,
      [JSON.stringify({ items: [{ product_id: box.id, quantity: 1 }], payments: [{ method: 'CASH', amount: 135 }] })]);
    expect(await stockOf(db, item.id)).toBe(6);
    expect(o.o.cogs_total).toBe(39);
    const cost = await db.asOne<{ unit_cost: string }>(manager, `select unit_cost from public.product_costs where product_id = $1`, [box.id]);
    expect(Number(cost.unit_cost)).toBe(39);
  });

  it('rejects producing a recipe-mode product', async () => {
    await expect(db.as(manager, `select public.create_production($1, 1)`, [shop.custard])).rejects.toThrow(/finished-good/);
  });

  it('keeps the ledger balanced', async () => {
    expect(await db.as(owner, `select * from public.check_inventory_integrity()`)).toHaveLength(0);
  });
});

describe.skipIf(!hasDb)('Phase 8: purchasing', () => {
  let db: TestDb;
  let manager: string, cashier: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;
  let supplier: string;

  beforeAll(async () => {
    db = await createTestDb();
    manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER');
    shop = await seedShop(db, manager);
    ({ id: supplier } = await db.asOne<{ id: string }>(manager, `insert into public.suppliers (name) values ('ฟาร์มไข่สด') returning id`));
  });
  afterAll(() => db?.destroy());

  it('drafts, edits and orders a purchase order', async () => {
    const items = JSON.stringify([{ ingredient_id: shop.egg, quantity: 60, unit_cost: 5 }, { ingredient_id: shop.milk, quantity: 2000, unit_cost: 0.06 }]);
    const { id } = await db.asOne<{ id: string }>(manager, `select public.save_purchase_order(null, $1, $2::jsonb) as id`, [supplier, items]);
    let po = await db.adminOne<{ subtotal: string; status: string; po_number: string }>(`select * from public.purchase_orders where id = $1`, [id]);
    expect(Number(po.subtotal)).toBe(420);
    expect(po.po_number).toMatch(/^PO\d{6}-0001$/);
    await db.as(manager, `select public.save_purchase_order($1, $2, $3::jsonb)`, [id, supplier, JSON.stringify([{ ingredient_id: shop.egg, quantity: 60, unit_cost: 5 }])]);
    await db.as(manager, `select public.set_purchase_order_status($1, 'ORDERED')`, [id]);
    await expect(db.as(manager, `select public.save_purchase_order($1, $2, $3::jsonb)`, [id, supplier, items])).rejects.toThrow(/only drafts/);
    po = await db.adminOne(`select * from public.purchase_orders where id = $1`, [id]);
    expect(po.status).toBe('ORDERED');
    await expect(db.as(cashier, `select public.save_purchase_order(null, $1, $2::jsonb)`, [supplier, items])).rejects.toThrow(/permission denied/);
    expect(await db.as(cashier, `select * from public.purchase_orders`)).toHaveLength(0);
  });

  it('receives partially then fully, updating stock and weighted average cost', async () => {
    const po = await db.adminOne<{ id: string }>(`select id from public.purchase_orders limit 1`);
    const line = await db.adminOne<{ id: string }>(`select id from public.purchase_items where purchase_order_id = $1`, [po.id]);
    await db.as(manager, `select public.receive_purchase_order($1, $2::jsonb)`, [po.id, JSON.stringify([{ purchase_item_id: line.id, quantity: 20 }])]);
    let status = await db.adminOne<{ status: string }>(`select status from public.purchase_orders where id = $1`, [po.id]);
    expect(status.status).toBe('ORDERED');
    expect(await stockOf(db, shop.egg)).toBe(120);
    // remaining 40 arrive at a higher actual price
    await db.as(manager, `select public.receive_purchase_order($1, $2::jsonb)`, [po.id, JSON.stringify([{ purchase_item_id: line.id, quantity: 40, unit_cost: 5.5 }])]);
    status = await db.adminOne(`select status from public.purchase_orders where id = $1`, [po.id]);
    expect(status.status).toBe('RECEIVED');
    const egg = await db.adminOne<{ stock_qty: string; avg_cost: string }>(`select stock_qty, avg_cost from public.ingredients where id = $1`, [shop.egg]);
    expect(Number(egg.stock_qty)).toBe(160);
    expect(Number(egg.avg_cost)).toBe(4.5); // (100×4 + 20×5 + 40×5.5) / 160 = 720/160
    await expect(db.as(manager, `select public.receive_purchase_order($1, $2::jsonb)`, [po.id, JSON.stringify([{ purchase_item_id: line.id, quantity: 1 }])]))
      .rejects.toThrow(/INVALID_STATE/);
  });

  it('records drawer payment for purchases and rejects over-receiving', async () => {
    const { id } = await db.asOne<{ id: string }>(manager, `select public.save_purchase_order(null, $1, $2::jsonb) as id`,
      [supplier, JSON.stringify([{ ingredient_id: shop.sugar, quantity: 1000, unit_cost: 0.03 }])]);
    const line = await db.adminOne<{ id: string }>(`select id from public.purchase_items where purchase_order_id = $1`, [id]);
    await expect(db.as(manager, `select public.receive_purchase_order($1, $2::jsonb)`, [id, JSON.stringify([{ purchase_item_id: line.id, quantity: 1001 }])]))
      .rejects.toThrow(/exceeds/);
    await expect(db.as(manager, `select public.receive_purchase_order($1, $2::jsonb, true)`, [id, JSON.stringify([{ purchase_item_id: line.id, quantity: 1000 }])]))
      .rejects.toThrow(/NO_OPEN_SESSION/);
    const session = await openSession(db, cashier, 500);
    await db.as(manager, `select public.receive_purchase_order($1, $2::jsonb, true)`, [id, JSON.stringify([{ purchase_item_id: line.id, quantity: 1000 }])]);
    const cash = await db.adminOne<{ amount: string; transaction_type: string }>(`select amount, transaction_type from public.cash_transactions where reference_id = $1`, [id]);
    expect([cash.transaction_type, Number(cash.amount)]).toEqual(['WITHDRAWAL', -30]);
    const s = await db.asOne<{ expected_cash: string; withdrawals: string }>(cashier, `select * from public.cash_session_summary where id = $1`, [session]);
    expect(Number(s.expected_cash)).toBe(470);
    expect(Number(s.withdrawals)).toBe(30);
  });
});

describe.skipIf(!hasDb)('Phase 9: cash sessions & expenses', () => {
  let db: TestDb;
  let owner: string, manager: string, cashier: string, kitchen: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER');
    manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER');
    kitchen = await db.createEmployee('KITCHEN');
    shop = await seedShop(db, manager);
  });
  afterAll(() => db?.destroy());

  it('opens exactly one session at a time', async () => {
    await expect(db.as(kitchen, `select public.open_cash_session(1000)`)).rejects.toThrow(/permission denied/);
    await openSession(db, cashier, 1000);
    await expect(db.as(manager, `select public.open_cash_session(500)`)).rejects.toThrow(/SESSION_ALREADY_OPEN/);
  });

  it('tracks expected cash through sales, refunds, expenses and movements, then reports variance', async () => {
    const order = (payload: object) => db.asOne<{ o: { id: string; items: { id: string }[] } }>(cashier, `select public.create_order($1::jsonb) as o`, [JSON.stringify(payload)]);
    await order({ items: [{ product_id: shop.custard, quantity: 2 }], payments: [{ method: 'CASH', amount: 118, tendered: 200 }] });   // +118
    await order({ items: [{ product_id: shop.custard, quantity: 1 }], payments: [{ method: 'QR', amount: 59 }] });                       // no cash
    const r = await order({ items: [{ product_id: shop.water, quantity: 3 }], payments: [{ method: 'CASH', amount: 30 }] });           // +30
    await db.as(manager, `select public.refund_order($1, $2::jsonb, 'ขวดแตก', 'CASH', false)`, [r.o.id, JSON.stringify([{ order_item_id: r.o.items[0]?.id, quantity: 1 }])]); // -10
    await db.as(manager, `select public.record_expense(null, 'น้ำแข็ง', 'ซื้อน้ำแข็ง', 25, 'CASH', true)`);                            // -25
    await db.as(cashier, `select public.cash_movement('WITHDRAWAL', 500, 'ฝากธนาคาร')`);                                                  // -500
    await db.as(cashier, `select public.cash_movement('DEPOSIT', 100, 'แลกเหรียญ')`);                                                     // +100
    await expect(db.as(cashier, `select public.cash_movement('SALE', 100, 'x')`)).rejects.toThrow(/DEPOSIT or WITHDRAWAL/);
    await expect(db.as(cashier, `select public.record_expense(null, 'x', 'x', 1)`)).rejects.toThrow(/permission denied/);

    const s = await db.asOne<Record<string, string>>(cashier, `select * from public.cash_session_summary where status = 'OPEN'`);
    expect(Number(s.cash_sales)).toBe(148);
    expect(Number(s.cash_refunds)).toBe(10);
    expect(Number(s.cash_expenses)).toBe(25);
    expect(Number(s.expected_cash)).toBe(1000 + 148 - 10 - 25 - 500 + 100);
    expect(s.opened_by_name).toBe('CASHIER');

    const closed = await db.asOne<{ expected_cash: string; actual_cash: string; variance: string; status: string }>(
      cashier, `select * from public.close_cash_session(710, 'ขาด 3 บาท')`);
    expect(closed.status).toBe('CLOSED');
    expect(Number(closed.expected_cash)).toBe(713);
    expect(Number(closed.variance)).toBe(-3);
    await expect(db.as(cashier, `select public.create_order($1::jsonb)`, [JSON.stringify({ items: [{ product_id: shop.water, quantity: 1 }], payments: [{ method: 'CASH', amount: 10 }] })]))
      .rejects.toThrow(/NO_OPEN_SESSION/);
  });

  it('voids an expense with a drawer reversal (owner only)', async () => {
    await openSession(db, cashier, 200);
    const e = await db.asOne<{ id: string }>(manager, `select id from public.record_expense(null, 'ของใช้', 'ทิชชู่', 40, 'CASH', true)`);
    await expect(db.as(manager, `select public.void_expense($1, 'ผิด')`, [e.id])).rejects.toThrow(/permission denied/);
    await db.as(owner, `select public.void_expense($1, 'บันทึกซ้ำ')`, [e.id]);
    const s = await db.asOne<{ expected_cash: string }>(cashier, `select expected_cash from public.cash_session_summary where status = 'OPEN'`);
    expect(Number(s.expected_cash)).toBe(200);
    await expect(db.as(owner, `select public.void_expense($1, 'again')`, [e.id])).rejects.toThrow(/already voided/);
  });

  it('keeps the cash ledger append-only', async () => {
    await expect(db.admin(`delete from public.cash_transactions`)).rejects.toThrow(/append-only/);
    await expect(db.as(manager, `insert into public.cash_transactions (cash_session_id, transaction_type, amount) select id, 'DEPOSIT', 1 from public.cash_sessions limit 1`))
      .rejects.toThrow(/permission denied/);
  });
});

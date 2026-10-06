import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { openSession, seedShop, stockOf } from './fixtures';

interface OrderDoc {
  id: string; order_number: string; queue_number: number; status: string; subtotal: number; total: number;
  promotion_discount: number; manual_discount: number; points_discount: number; vat_amount: number;
  cogs_total: number; points_earned: number; refunded_total: number; duplicate?: boolean;
  items: { id: string; product_name: string; quantity: number; unit_cost: number; cogs_total: number; refunded_quantity: number }[];
  payments: { method: string; amount: number; tendered: number | null; change_amount: number }[];
}

describe.skipIf(!hasDb)('Phase 5–6: orders, payments, automatic deduction', () => {
  let db: TestDb;
  let owner: string, manager: string, cashier: string, kitchen: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;

  const order = async (user: string, payload: object) =>
    (await db.asOne<{ o: OrderDoc }>(user, `select public.create_order($1::jsonb) as o`, [JSON.stringify(payload)])).o;
  const cash = (amount: number, tendered?: number) => ({ method: 'CASH', amount, tendered: tendered ?? amount });

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER');
    manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER');
    kitchen = await db.createEmployee('KITCHEN');
    shop = await seedShop(db, manager);
  });
  afterAll(() => db?.destroy());

  it('requires an open cash session', async () => {
    await expect(order(cashier, { items: [{ product_id: shop.custard, quantity: 1 }], payments: [cash(59)] }))
      .rejects.toThrow(/NO_OPEN_SESSION/);
    await openSession(db, cashier);
  });

  it('sells, deducts recipe ingredients and records COGS in one transaction', async () => {
    const eggBefore = await stockOf(db, shop.egg);
    const o = await order(cashier, {
      items: [{ product_id: shop.custard, quantity: 2, note: 'หวานน้อย' }, { product_id: shop.box, quantity: 1 }],
      payments: [cash(317, 500)],
    });
    expect(o.subtotal).toBe(59 * 2 + 199);
    expect(o.total).toBe(317);
    expect(o.queue_number).toBe(1);
    expect(o.payments[0]).toMatchObject({ method: 'CASH', amount: 317, tendered: 500, change_amount: 183 });
    // 2 custards + box of 4 = 6 pieces → 6 eggs, 600 ml, 120 g → cogs 6 × 9.60 = 57.60
    expect(await stockOf(db, shop.egg)).toBe(eggBefore - 6);
    expect(o.cogs_total).toBe(57.6);
    expect(o.items.find((i) => i.product_name === 'คัสตาร์ดกล่อง 4')?.unit_cost).toBe(38.4);
    const cashRows = await db.admin(`select amount from public.cash_transactions where reference_id = $1`, [o.id]);
    expect(Number(cashRows[0]?.amount)).toBe(317);
    const audit = await db.admin(`select 1 from public.audit_logs where action = 'CREATE_ORDER' and entity_id = $1`, [o.id]);
    expect(audit).toHaveLength(1);
  });

  it('ignores client-side prices — pricing always comes from the database', async () => {
    const o = await order(cashier, { items: [{ product_id: shop.water, quantity: 1, unit_price: 0.01, price: 0 }], payments: [cash(10)] });
    expect(o.total).toBe(10);
    expect(o.cogs_total).toBe(0); // NONE mode: no stock movement
  });

  it('supports mixed payments and rejects mismatched totals', async () => {
    const o = await order(cashier, {
      items: [{ product_id: shop.custard, quantity: 2 }],
      payments: [{ method: 'QR', amount: 100, reference: 'TX1' }, cash(18, 20)],
    });
    expect(o.payments.map((p) => p.method).sort()).toEqual(['CASH', 'QR']);
    await expect(order(cashier, { items: [{ product_id: shop.custard, quantity: 1 }], payments: [cash(50)] })).rejects.toThrow(/PAYMENT_MISMATCH/);
    await expect(order(cashier, { items: [{ product_id: shop.custard, quantity: 1 }], payments: [cash(59, 40)] })).rejects.toThrow(/tendered/);
    await expect(order(cashier, { items: [{ product_id: shop.custard, quantity: 1 }], payments: [cash(30), cash(30)] })).rejects.toThrow(/PAYMENT_MISMATCH/);
  });

  it('deducts finished goods and blocks sales beyond stock without partial writes', async () => {
    await db.as(manager, `select public.adjust_stock($1, 5, 8, 'baked')`, [shop.tartItem]);
    const eggBefore = await stockOf(db, shop.egg);
    const ordersBefore = await db.admin('select 1 from public.orders');
    await expect(order(cashier, {
      items: [{ product_id: shop.custard, quantity: 1 }, { product_id: shop.tart, quantity: 6 }], payments: [cash(209)],
    })).rejects.toThrow(/INSUFFICIENT_STOCK/);
    expect(await stockOf(db, shop.egg)).toBe(eggBefore);                       // custard line rolled back
    expect(await db.admin('select 1 from public.orders')).toHaveLength(ordersBefore.length);
    const ok = await order(cashier, { items: [{ product_id: shop.tart, quantity: 5 }], payments: [cash(125)] });
    expect(ok.cogs_total).toBe(40);
    expect(await stockOf(db, shop.tartItem)).toBe(0);
  });

  it('refuses to sell a recipe product that has no active recipe', async () => {
    await expect(order(cashier, { items: [{ product_id: shop.noRecipe, quantity: 1 }], payments: [cash(30)] })).rejects.toThrow(/NO_ACTIVE_RECIPE/);
  });

  it('applies promotions, member rules and the cashier discount limit', async () => {
    const quote = async (payload: object) =>
      (await db.asOne<{ q: { total: number; promotion_discount: number; points_earned: number } }>(cashier, `select public.quote_order($1::jsonb) as q`, [JSON.stringify(payload)])).q;
    const q1 = await quote({ items: [{ product_id: shop.custard, quantity: 10 }], promo_code: 'ten' });
    expect(q1.promotion_discount).toBe(50); // 10% of 590 capped at 50
    expect(q1.total).toBe(540);
    await expect(quote({ items: [{ product_id: shop.custard, quantity: 2 }], promotion_id: shop.membersPromo })).rejects.toThrow(/members only/);
    await expect(quote({ items: [{ product_id: shop.custard, quantity: 1 }], promotion_id: shop.membersPromo, customer_id: shop.customer })).rejects.toThrow(/minimum/);
    await expect(order(cashier, { items: [{ product_id: shop.custard, quantity: 2 }], manual_discount: 60, payments: [cash(58)] })).rejects.toThrow(/DISCOUNT_LIMIT/);
    const m = await order(manager, { items: [{ product_id: shop.custard, quantity: 2 }], manual_discount: 60, payments: [cash(58)] });
    expect(m.manual_discount).toBe(60);
  });

  it('earns and redeems loyalty points through the points ledger', async () => {
    const o1 = await order(cashier, { items: [{ product_id: shop.custard, quantity: 5 }], customer_id: shop.customer, payments: [cash(295)] });
    expect(o1.points_earned).toBe(11); // floor(295 / 25)
    await expect(order(cashier, { items: [{ product_id: shop.custard, quantity: 1 }], customer_id: shop.customer, redeem_points: 5, payments: [cash(54)] }))
      .rejects.toThrow(/below minimum/);
    const o2 = await order(cashier, { items: [{ product_id: shop.custard, quantity: 1 }], customer_id: shop.customer, redeem_points: 10, payments: [cash(49)] });
    expect(o2.points_discount).toBe(10);
    const c = await db.adminOne<{ points_balance: number; visit_count: number }>(`select points_balance, visit_count from public.customers where id = $1`, [shop.customer]);
    expect(c.points_balance).toBe(11 - 10 + 1);
    expect(c.visit_count).toBe(2);
    const ledger = await db.admin(`select reason, change from public.customer_points where customer_id = $1 order by created_at, id`, [shop.customer]);
    // rows within one transaction share created_at, so compare as a multiset
    expect(ledger.map((r) => `${r.reason}:${r.change}`).sort()).toEqual(['EARN:1', 'EARN:11', 'REDEEM:-10']);
  });

  it('is idempotent on client_ref (safe offline retries)', async () => {
    const ref = randomUUID();
    const payload = { client_ref: ref, items: [{ product_id: shop.custard, quantity: 1 }], payments: [cash(59)] };
    const eggBefore = await stockOf(db, shop.egg);
    const a = await order(cashier, payload);
    const b = await order(cashier, payload);
    expect(b.id).toBe(a.id);
    expect(b.duplicate).toBe(true);
    expect(await stockOf(db, shop.egg)).toBe(eggBefore - 1);
  });

  it('assigns sequential queue numbers per business day', async () => {
    const rows = await db.admin<{ queue_number: number }>(`select queue_number from public.orders order by queue_number`);
    expect(rows.map((r) => r.queue_number)).toEqual(rows.map((_, i) => i + 1));
  });

  it('cancels an order with a full reversal (manager only)', async () => {
    const o = await order(cashier, { items: [{ product_id: shop.custard, quantity: 3 }], customer_id: shop.customer, payments: [cash(177)] });
    const eggBefore = await stockOf(db, shop.egg);
    await expect(db.as(cashier, `select public.cancel_order($1, 'ลูกค้าเปลี่ยนใจ')`, [o.id])).rejects.toThrow(/permission denied/);
    const c = (await db.asOne<{ o: OrderDoc }>(manager, `select public.cancel_order($1, 'ลูกค้าเปลี่ยนใจ') as o`, [o.id])).o;
    expect(c.status).toBe('CANCELLED');
    expect(await stockOf(db, shop.egg)).toBe(eggBefore + 3);
    const refund = await db.adminOne<{ amount: string }>(`select amount from public.cash_transactions where reference_id = $1 and transaction_type = 'REFUND'`, [o.id]);
    expect(Number(refund.amount)).toBe(-177);
    await expect(db.as(manager, `select public.cancel_order($1, 'again')`, [o.id])).rejects.toThrow(/INVALID_STATE/);
  });

  it('refunds part of an order, optionally restocking, with proportional discount allocation', async () => {
    const o = await order(manager, {
      items: [{ product_id: shop.custard, quantity: 4 }, { product_id: shop.water, quantity: 2 }],
      manual_discount: 25.6, payments: [{ method: 'TRANSFER', amount: 230.4 }],
    }); // subtotal 256 → paid 230.40 (90%)
    const custardItem = o.items.find((i) => i.product_name === 'คาราเมลคัสตาร์ด');
    if (!custardItem) throw new Error('missing item');
    const eggBefore = await stockOf(db, shop.egg);
    const r1 = (await db.asOne<{ o: OrderDoc }>(manager, `select public.refund_order($1, $2::jsonb, 'เสียหาย', 'TRANSFER', true) as o`,
      [o.id, JSON.stringify([{ order_item_id: custardItem.id, quantity: 1 }])])).o;
    expect(r1.status).toBe('PARTIALLY_REFUNDED');
    expect(r1.refunded_total).toBe(53.1); // 59 × 0.9
    expect(await stockOf(db, shop.egg)).toBe(eggBefore + 1);
    const refund = await db.adminOne<{ cogs_reversed: string; refund_number: string }>(`select cogs_reversed, refund_number from public.refunds where order_id = $1`, [o.id]);
    expect(Number(refund.cogs_reversed)).toBe(9.6);
    expect(refund.refund_number).toMatch(/^RF\d{6}-0001$/);
    await expect(db.as(manager, `select public.refund_order($1, $2::jsonb, 'x', 'CASH', false)`,
      [o.id, JSON.stringify([{ order_item_id: custardItem.id, quantity: 4 }])])).rejects.toThrow(/exceeds remaining/);
    // refund the rest without restocking → REFUNDED, stock unchanged
    const rest = o.items.map((i) => ({ order_item_id: i.id, quantity: i.product_name === 'คาราเมลคัสตาร์ด' ? 3 : i.quantity }));
    const r2 = (await db.asOne<{ o: OrderDoc }>(manager, `select public.refund_order($1, $2::jsonb, 'ปิดร้าน', 'CASH', false) as o`, [o.id, JSON.stringify(rest)])).o;
    expect(r2.status).toBe('REFUNDED');
    expect(r2.refunded_total).toBe(230.4);
    expect(await stockOf(db, shop.egg)).toBe(eggBefore + 1);
  });

  it('lets the kitchen see and update the queue, but not sell', async () => {
    const q = await db.as<{ queue_number: number; items: unknown[] }>(kitchen, `select * from public.kitchen_queue`);
    expect(q.length).toBeGreaterThan(0);
    const first = await db.adminOne<{ id: string }>(`select id from public.orders where status = 'COMPLETED' limit 1`);
    await db.as(kitchen, `select public.set_kitchen_status($1, 'READY')`, [first.id]);
    expect((await db.adminOne<{ kitchen_status: string }>(`select kitchen_status from public.orders where id = $1`, [first.id])).kitchen_status).toBe('READY');
    await expect(order(kitchen, { items: [{ product_id: shop.custard, quantity: 1 }], payments: [cash(59)] })).rejects.toThrow(/permission denied/);
  });

  it('keeps stock equal to the ledger after all of the above', async () => {
    expect(await db.as(owner, `select * from public.check_inventory_integrity()`)).toHaveLength(0);
  });
});

describe.skipIf(!hasDb)('product availability', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(() => db?.destroy());

  it('derives sellable units from recipe stock and finished goods', async () => {
    const manager = await db.createEmployee('MANAGER');
    const shop = await seedShop(db, manager);
    await db.as(manager, `select public.adjust_stock($1, 7, 8, 'baked')`, [shop.tartItem]);
    const rows = await db.as<{ product_id: string; available: number | null }>(manager, 'select * from public.product_availability');
    const of = (id: string) => rows.find((r) => r.product_id === id)?.available;
    expect(of(shop.custard)).toBe(100);   // limited by 100 eggs, 1 per piece
    expect(of(shop.box)).toBe(25);        // 4 eggs per box
    expect(of(shop.tart)).toBe(7);
    expect(of(shop.water)).toBeNull();
  });
});

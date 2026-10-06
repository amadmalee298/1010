import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { openSession, seedShop } from './fixtures';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

describe.skipIf(!hasDb)('Phase 10: reports & P&L', () => {
  let db: TestDb;
  let manager: string, cashier: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;
  const d = today();

  beforeAll(async () => {
    db = await createTestDb();
    manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER');
    shop = await seedShop(db, manager);
    await openSession(db, cashier, 500);
    const order = (user: string, payload: object) => db.asOne<{ o: { id: string; items: { id: string }[] } }>(user, `select public.create_order($1::jsonb) as o`, [JSON.stringify(payload)]);
    // A: 4 custards = 236, cogs 38.40
    await order(cashier, { items: [{ product_id: shop.custard, quantity: 4 }], payments: [{ method: 'CASH', amount: 236 }] });
    // B: box 199 with 19 manual discount (manager) = 180 paid by QR, cogs 38.40
    await order(manager, { items: [{ product_id: shop.box, quantity: 1 }], manual_discount: 19, payments: [{ method: 'QR', amount: 180 }] });
    // C: 2 custards = 118 → cancelled, excluded entirely
    const c = await order(cashier, { items: [{ product_id: shop.custard, quantity: 2 }], payments: [{ method: 'CASH', amount: 118 }] });
    await db.as(manager, `select public.cancel_order($1, 'test')`, [c.o.id]);
    // D: 2 custards = 118, refund 1 with restock → refund 59, cogs back 9.60
    const r = await order(cashier, { items: [{ product_id: shop.custard, quantity: 2 }], payments: [{ method: 'CASH', amount: 118 }] });
    await db.as(manager, `select public.refund_order($1, $2::jsonb, 'x', 'CASH', true)`, [r.o.id, JSON.stringify([{ order_item_id: r.o.items[0]?.id, quantity: 1 }])]);
    // waste 5 eggs @4 = 20; expense 100; count shrinkage: lose 10 g sugar @0.03 = 0.30
    await db.as(cashier, `select public.record_waste($1, 5, 'แตก')`, [shop.egg]);
    await db.as(manager, `select public.record_expense($1::date, 'ค่าไฟ', 'บิลไฟ', 100, 'TRANSFER', false)`, [d]);
    const sugar = await db.adminOne<{ stock_qty: string }>(`select stock_qty from public.ingredients where id = $1`, [shop.sugar]);
    await db.as(manager, `select public.record_stock_count($1, $2, 'นับ')`, [shop.sugar, Number(sugar.stock_qty) - 10]);
  });
  afterAll(() => db?.destroy());

  it('computes the profit & loss statement', async () => {
    const { p } = await db.asOne<{ p: Record<string, number> }>(manager, `select public.report_pnl($1::date, $1::date) as p`, [d]);
    expect(Number(p.gross_sales)).toBe(236 + 199 + 118);
    expect(Number(p.discounts)).toBe(19);
    expect(Number(p.refunds)).toBe(59);
    expect(Number(p.net_sales)).toBe(236 + 180 + 118 - 59);           // 475
    expect(Number(p.cogs)).toBeCloseTo(38.4 + 38.4 + 19.2 - 9.6, 2);   // 86.40
    expect(Number(p.gross_profit)).toBeCloseTo(475 - 86.4, 2);
    expect(Number(p.waste)).toBe(20);
    expect(Number(p.shrinkage)).toBeCloseTo(0.3, 2);
    expect(Number(p.expenses_total)).toBe(100);
    expect(Number(p.net_profit)).toBeCloseTo(475 - 86.4 - 20 - 0.3 - 100, 2);
  });

  it('reports products with menu profitability', async () => {
    const rows = await db.as<{ product_name: string; quantity: string; net_sales: string; cogs: string; gross_margin: string }>(
      manager, `select * from public.report_products($1::date, $1::date)`, [d]);
    const custard = rows.find((r) => r.product_name === 'คาราเมลคัสตาร์ด');
    expect(Number(custard?.quantity)).toBe(5);          // 4 + 2 − 1 refunded (cancelled excluded)
    expect(Number(custard?.net_sales)).toBe(295);
    expect(Number(custard?.cogs)).toBeCloseTo(48, 2);
    const box = rows.find((r) => r.product_name === 'คัสตาร์ดกล่อง 4');
    expect(Number(box?.net_sales)).toBe(180);           // discount allocated
  });

  it('reports sales breakdowns, cash, employees and inventory', async () => {
    const { s } = await db.asOne<{ s: { summary: Record<string, number>; by_payment: { method: string; amount: number }[]; by_day: unknown[] } }>(
      manager, `select public.report_sales($1::date, $1::date) as s`, [d]);
    expect(Number(s.summary.orders)).toBe(3);
    expect(Number(s.summary.cancelled)).toBe(1);
    expect(s.by_payment.map((p) => [p.method, Number(p.amount)]).sort()).toEqual([['CASH', 354], ['QR', 180]]);
    expect(s.by_day).toHaveLength(1);
    const cash = await db.asOne<{ expected_cash: string }>(manager, `select expected_cash from public.report_cash($1::date, $1::date)`, [d]);
    expect(Number(cash.expected_cash)).toBe(500 + 236 + 118 - 118 + 118 - 59);
    const staff = await db.as<{ orders: string }>(manager, `select * from public.report_employee_sales($1::date, $1::date)`, [d]);
    expect(staff.reduce((n, r) => n + Number(r.orders), 0)).toBe(3);
    const inv = await db.as<{ name_th: string; sold: string; wasted: string; returned: string }>(manager, `select * from public.report_inventory($1::date, $1::date)`, [d]);
    const egg = inv.find((r) => r.name_th === 'ไข่ไก่');
    expect(Number(egg?.sold)).toBe(4 + 4 + 2 + 2);
    expect(Number(egg?.wasted)).toBe(5);
    expect(Number(egg?.returned)).toBe(2 + 1);
  });

  it('serves the dashboard and restricts reports to management', async () => {
    const { x } = await db.asOne<{ x: { orders: number; top_products: unknown[]; trend: unknown[]; open_session: boolean } }>(manager, `select public.dashboard() as x`);
    expect(Number(x.orders)).toBe(3);
    expect(x.trend).toHaveLength(14);
    expect(x.top_products.length).toBeGreaterThan(0);
    expect(x.open_session).toBe(true);
    await expect(db.as(cashier, `select public.report_pnl($1::date, $1::date)`, [d])).rejects.toThrow(/permission denied/);
    await expect(db.as(cashier, `select * from public.order_financials`)).rejects.toThrow(/permission denied/);
    await expect(db.as(manager, `select public.report_pnl('2020-01-01', '2026-01-01')`)).rejects.toThrow(/max 366/);
  });
});

describe.skipIf(!hasDb)('Phase 11: customers & promotions', () => {
  let db: TestDb;
  let manager: string, cashier: string, customer: string;
  beforeAll(async () => {
    db = await createTestDb();
    manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER');
    ({ id: customer } = await db.asOne<{ id: string }>(cashier, `insert into public.customers (name, phone) values ('มานี', '0812345678') returning id`));
  });
  afterAll(() => db?.destroy());

  it('adjusts points only through the ledger, manager only, never below zero', async () => {
    await db.as(manager, `select public.adjust_customer_points($1, 50, 'ชดเชย')`, [customer]);
    await expect(db.as(cashier, `select public.adjust_customer_points($1, 50, 'x')`, [customer])).rejects.toThrow(/permission denied/);
    await expect(db.as(manager, `select public.adjust_customer_points($1, -60, 'x')`, [customer])).rejects.toThrow(/POINTS_INVALID|points_balance/);
    await expect(db.as(cashier, `update public.customers set points_balance = 999 where id = $1`, [customer])).rejects.toThrow(/permission denied/);
    const c = await db.adminOne<{ points_balance: number }>(`select points_balance from public.customers where id = $1`, [customer]);
    expect(c.points_balance).toBe(50);
    expect(await db.as(manager, `select * from public.customer_points where customer_id = $1`, [customer])).toHaveLength(1);
  });

  it('lets cashiers edit contact details and validates phone numbers', async () => {
    await db.as(cashier, `update public.customers set name = 'มานี ใจดี' where id = $1`, [customer]);
    await expect(db.as(cashier, `insert into public.customers (name, phone) values ('x', '123')`)).rejects.toThrow(/check constraint/);
  });

  it('allows only managers to create promotions and validates percent bounds', async () => {
    await db.as(manager, `insert into public.promotions (name, code, discount_type, value) values ('ลด 5%', 'FIVE', 'PERCENT', 5)`);
    await expect(db.as(cashier, `insert into public.promotions (name, discount_type, value) values ('x', 'FIXED', 5)`)).rejects.toThrow(/permission denied|row-level/);
    await expect(db.as(manager, `insert into public.promotions (name, discount_type, value) values ('x', 'PERCENT', 120)`)).rejects.toThrow(/percent_max_100/);
  });
});

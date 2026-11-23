import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { openSession, seedShop, stockOf } from './fixtures';

describe.skipIf(!hasDb)('Phase 24: offline sales are recorded even when stock is short', () => {
  let db: TestDb;
  let manager: string, cashier: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;
  const order = async (payload: object) =>
    (await db.asOne<{ o: { order_number: string; cogs_total: number } }>(cashier, `select public.create_order($1::jsonb) as o`,
      [JSON.stringify({ client_ref: randomUUID(), ...payload })])).o;
  const cash = (amount: number) => ({ method: 'CASH', amount, tendered: amount });

  beforeAll(async () => {
    db = await createTestDb();
    manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER');
    shop = await seedShop(db, manager);
    await openSession(db, cashier);
    // exactly 2 tarts in stock at 8 THB each
    const have = await stockOf(db, shop.tartItem);
    if (have > 0) await db.as(manager, `select public.record_stock_count($1, 0, 'reset')`, [shop.tartItem]);
    await db.as(manager, `select public.adjust_stock($1, 2, 8, 'baked')`, [shop.tartItem]);
  });
  afterAll(() => db?.destroy());

  it('still stops an online sale at zero stock', async () => {
    await expect(order({ items: [{ product_id: shop.tart, quantity: 3 }], payments: [cash(75)] })).rejects.toThrow(/INSUFFICIENT_STOCK/);
    expect(await stockOf(db, shop.tartItem)).toBe(2);
  });

  it('records an offline sale beyond stock, taking stock negative at average cost', async () => {
    // a sale rung up right now cannot claim to be offline
    await expect(order({ items: [{ product_id: shop.tart, quantity: 3 }], payments: [cash(75)], offline: true, sold_at: new Date().toISOString() }))
      .rejects.toThrow(/INSUFFICIENT_STOCK/);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const o = await order({ items: [{ product_id: shop.tart, quantity: 3 }], payments: [cash(75)], offline: true, sold_at: fiveMinutesAgo });
    expect(o.order_number).toBeTruthy();
    expect(Number(o.cogs_total)).toBe(24);
    expect(await stockOf(db, shop.tartItem)).toBe(-1);
  });

  it('does not leak the offline permission into the next request', async () => {
    await expect(order({ items: [{ product_id: shop.tart, quantity: 1 }], payments: [cash(25)] })).rejects.toThrow(/INSUFFICIENT_STOCK/);
    expect(await stockOf(db, shop.tartItem)).toBe(-1);
  });
});

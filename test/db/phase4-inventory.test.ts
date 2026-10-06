import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';

describe.skipIf(!hasDb)('Phase 4: inventory ledger', () => {
  let db: TestDb;
  let manager: string, cashier: string, kitchen: string;
  let egg: string;

  const stock = async (id: string) =>
    db.adminOne<{ stock_qty: string; avg_cost: string }>('select stock_qty, avg_cost from public.ingredients where id = $1', [id])
      .then((r) => ({ qty: Number(r.stock_qty), cost: Number(r.avg_cost) }));

  beforeAll(async () => {
    db = await createTestDb();
    manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER');
    kitchen = await db.createEmployee('KITCHEN');
    ({ id: egg } = await db.asOne<{ id: string }>(manager, `insert into public.ingredients (name_th, unit) values ('ไข่ไก่', 'ฟอง') returning id`));
  });
  afterAll(() => db?.destroy());

  it('posts opening stock with cost and computes weighted average cost', async () => {
    await db.as(manager, `select public.adjust_stock($1, 100, 4, 'ยอดยกมา')`, [egg]);
    expect(await stock(egg)).toEqual({ qty: 100, cost: 4 });
    // simulate a purchase at a higher price (purchase RPC arrives in phase 8)
    await db.admin(`select public.post_inventory($1, 'PURCHASE', 50, 5.5, 'test', null, null)`, [egg]);
    expect(await stock(egg)).toEqual({ qty: 150, cost: 4.5 }); // (100*4 + 50*5.5)/150
  });

  it('values outbound movements at current average cost (cannot be spoofed)', async () => {
    const t = await db.adminOne<{ unit_cost: string; balance_after: string; total_cost: string }>(
      `select unit_cost, balance_after, total_cost from public.post_inventory($1, 'SALE', -10, 999, 'test', null, null)`, [egg]);
    expect(Number(t.unit_cost)).toBe(4.5);
    expect(Number(t.balance_after)).toBe(140);
    expect(Number(t.total_cost)).toBe(-45);
    expect((await stock(egg)).cost).toBe(4.5);
  });

  it('blocks stock from going negative and leaves no partial change', async () => {
    await expect(db.admin(`select public.post_inventory($1, 'SALE', -1000, 0, 'test', null, null)`, [egg]))
      .rejects.toThrow(/INSUFFICIENT_STOCK/);
    expect((await stock(egg)).qty).toBe(140);
  });

  it('enforces sign rules per transaction type', async () => {
    await expect(db.admin(`select public.post_inventory($1, 'PURCHASE', -5, 1, 'test', null, null)`, [egg])).rejects.toThrow(/invalid quantity sign/);
    await expect(db.admin(`select public.post_inventory($1, 'WASTE', 5, 1, 'test', null, null)`, [egg])).rejects.toThrow(/invalid quantity sign/);
  });

  it('records waste from front-of-house with cost and audit', async () => {
    const w = await db.asOne<{ quantity: string; unit_cost: string; total_cost: string; inventory_transaction_id: string }>(
      cashier, `select * from public.record_waste($1, 2, 'ไข่แตก')`, [egg]);
    expect(Number(w.total_cost)).toBe(9);
    expect(w.inventory_transaction_id).toBeTruthy();
    expect((await stock(egg)).qty).toBe(138);
    await expect(db.as(kitchen, `select public.record_waste($1, 1, 'x')`, [egg])).rejects.toThrow(/permission denied/);
    await expect(db.as(cashier, `select public.record_waste($1, 1, '  ')`, [egg])).rejects.toThrow(/reason/);
  });

  it('posts stock counts as adjustments; cashiers cannot adjust', async () => {
    await db.as(manager, `select public.record_stock_count($1, 135, 'นับปลายวัน')`, [egg]);
    expect((await stock(egg)).qty).toBe(135);
    const last = await db.adminOne<{ transaction_type: string; quantity: string }>(
      `select transaction_type, quantity from public.inventory_transactions where ingredient_id = $1 order by created_at desc, id desc limit 1`, [egg]);
    expect(last.transaction_type).toBe('ADJUSTMENT');
    expect(Number(last.quantity)).toBe(-3);
    await expect(db.as(cashier, `select public.adjust_stock($1, 10, 1, 'x')`, [egg])).rejects.toThrow(/permission denied/);
    await expect(db.as(cashier, `select public.record_stock_count($1, 10, 'x')`, [egg])).rejects.toThrow(/permission denied/);
    await expect(db.as(manager, `select public.adjust_stock($1, 10, 1, '')`, [egg])).rejects.toThrow(/note is required/);
  });

  it('keeps the ledger append-only and in balance', async () => {
    await expect(db.admin(`update public.inventory_transactions set quantity = 1`)).rejects.toThrow(/append-only/);
    await expect(db.admin(`delete from public.inventory_transactions`)).rejects.toThrow(/append-only/);
    await expect(db.as(manager, `insert into public.inventory_transactions (ingredient_id, transaction_type, quantity) values ($1, 'PURCHASE', 1)`, [egg]))
      .rejects.toThrow(/permission denied/);
    expect(await db.as(manager, `select * from public.check_inventory_integrity()`)).toHaveLength(0);
    const r = await db.adminOne<{ difference: string }>(`select difference from public.inventory_reconciliation where ingredient_id = $1`, [egg]);
    expect(Number(r.difference)).toBe(0);
  });

  it('cannot call the internal posting helper directly', async () => {
    await expect(db.as(manager, `select public.post_inventory($1, 'PURCHASE', 1, 1, 'x', null, null)`, [egg])).rejects.toThrow(/permission denied/);
  });

  it('exposes stock levels with low-stock flags', async () => {
    await db.as(manager, `update public.ingredients set reorder_level = 200 where id = $1`, [egg]);
    const s = await db.asOne<{ is_low: boolean; stock_value: string }>(cashier, `select is_low, stock_value from public.stock_levels where id = $1`, [egg]);
    expect(s.is_low).toBe(true);
    expect(Number(s.stock_value)).toBe(607.5);
  });
});

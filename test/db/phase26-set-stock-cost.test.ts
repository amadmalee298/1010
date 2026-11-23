import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { seedShop, stockOf } from './fixtures';

describe.skipIf(!hasDb)('Phase 26: set quantity and price in one step', () => {
  let db: TestDb;
  let owner: string, cashier: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;
  const bal = async (code: string) =>
    Number((await db.adminOne<{ b: string }>(`select coalesce(sum(debit - credit), 0) as b from public.gl_lines where account_code = $1`, [code])).b);
  const avg = async (id: string) => Number((await db.adminOne<{ c: string }>(`select avg_cost as c from public.ingredients where id = $1`, [id])).c);

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER');
    cashier = await db.createEmployee('CASHIER');
    shop = await seedShop(db, owner);
  });
  afterAll(() => db?.destroy());

  it('sets stock and an exact average cost without touching shrinkage', async () => {
    expect(await stockOf(db, shop.egg)).toBeGreaterThan(0);
    const shrink = await bal('5300');
    await db.as(owner, `select public.set_stock_cost($1, 150, 4.5, null)`, [shop.egg]);
    expect(await stockOf(db, shop.egg)).toBe(150);
    expect(await avg(shop.egg)).toBe(4.5);
    expect(await bal('5300')).toBeCloseTo(shrink, 2);
    expect(await bal('1200')).toBeGreaterThan(0);
    const tb = Number((await db.adminOne<{ b: string }>(`select coalesce(sum(debit - credit), 0) as b from public.gl_lines`)).b);
    expect(tb).toBeCloseTo(0, 2);
    const today = (await db.adminOne<{ d: string }>(`select public.bkk_date(now())::text as d`)).d;
    const pnl = (await db.asOne<{ p: { shrinkage: number } }>(owner, `select public.report_pnl($1::date, $1::date) as p`, [today])).p;
    expect(Number(pnl.shrinkage)).toBeCloseTo(0, 2);
  });

  it('also fixes negative stock and an item with no stock', async () => {
    await db.admin(`update public.ingredients set allow_negative = true where id = $1`, [shop.sugar]);
    await db.as(owner, `select public.adjust_stock($1, -6000, null, 'oversold')`, [shop.sugar]);
    expect(await stockOf(db, shop.sugar)).toBeLessThan(0);
    await db.as(owner, `select public.set_stock_cost($1, 1000, 0.012, 'ยอดยกมา')`, [shop.sugar]);
    expect(await stockOf(db, shop.sugar)).toBe(1000);
    expect(await avg(shop.sugar)).toBe(0.012);
  });

  it('is for managers only and validates input', async () => {
    await expect(db.as(cashier, `select public.set_stock_cost($1, 1, 1, null)`, [shop.egg])).rejects.toThrow();
    await expect(db.as(owner, `select public.set_stock_cost($1, -1, 1, null)`, [shop.egg])).rejects.toThrow(/VALIDATION/);
  });
});

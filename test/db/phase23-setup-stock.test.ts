import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { seedShop } from './fixtures';

const migration = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261006001900_phase23_setup_stock_to_opening.sql'), 'utf8');

describe.skipIf(!hasDb)('Phase 23: set-up stock corrections move from 5300 to opening stock', () => {
  let db: TestDb;
  let owner: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;
  const bal = async (code: string) =>
    Number((await db.adminOne<{ b: string }>(`select coalesce(sum(debit - credit), 0) as b from public.gl_lines where account_code = $1`, [code])).b);

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER', 'kameenee.sa');
    shop = await seedShop(db, owner);
  });
  afterAll(() => db?.destroy());

  it('clears the shrinkage from a count-to-0 and keeps stock, totals and the movements', async () => {
    const shrink0 = await bal('5300');
    const opening0 = await bal('3100');
    // eggs were 100 @ 4: count to 0, then receive again at the real price; also a manual decrease of milk
    await db.as(owner, `select public.record_stock_count($1, 0, 'แก้ต้นทุน')`, [shop.egg]);
    await db.as(owner, `select public.adjust_stock($1, 100, 3.5, 'แก้ต้นทุนไข่')`, [shop.egg]);
    await db.as(owner, `select public.adjust_stock($1, -1000, null, 'ปรับยอด')`, [shop.milk]);
    expect(await bal('5300') - shrink0).toBeCloseTo(400 + 50, 2);
    const stock = await bal('1200');
    const moves = Number((await db.adminOne<{ n: string }>(`select count(*) as n from public.inventory_transactions`)).n);

    await db.admin(migration);

    expect(await bal('5300')).toBeCloseTo(0, 2);
    expect(await bal('3100') - opening0).toBeCloseTo(-350 + 450, 2); // -(100*3.5) received, +450 moved
    expect(await bal('1200')).toBeCloseTo(stock, 2);
    expect(Number((await db.adminOne<{ n: string }>(`select count(*) as n from public.inventory_transactions`)).n)).toBe(moves);
    const tb = Number((await db.adminOne<{ b: string }>(`select coalesce(sum(debit - credit), 0) as b from public.gl_lines`)).b);
    expect(tb).toBeCloseTo(0, 2);
    const jv = await db.admin<{ is_opening: boolean; memo: string }>(`select is_opening, memo from public.journal_entries`);
    expect(jv).toHaveLength(1);
    expect(jv[0]).toMatchObject({ is_opening: true });
    expect(jv[0]!.memo).toContain('2 รายการ');
  });
});

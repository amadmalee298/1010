import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { seedShop } from './fixtures';

describe.skipIf(!hasDb)('Phase 27: ingredient packs', () => {
  let db: TestDb;
  let owner: string, cashier: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER');
    cashier = await db.createEmployee('CASHIER');
    shop = await seedShop(db, owner);
  });
  afterAll(() => db?.destroy());

  it('stores the buying unit and shows it in stock_levels', async () => {
    await db.as(owner, `update public.ingredients set pack_unit = 'แผง', pack_size = 30, pack_price = 150 where id = $1`, [shop.egg]);
    const row = await db.asOne<{ pack_unit: string; pack_size: string; pack_price: string }>(cashier,
      `select pack_unit, pack_size, pack_price from public.stock_levels where id = $1`, [shop.egg]);
    expect(row.pack_unit).toBe('แผง');
    expect(Number(row.pack_size)).toBe(30);
    expect(Number(row.pack_price)).toBe(150);
  });

  it('needs a pack name and size together, and a positive size', async () => {
    await expect(db.as(owner, `update public.ingredients set pack_unit = 'ถุง', pack_size = null where id = $1`, [shop.sugar])).rejects.toThrow(/ingredients_pack_complete/);
    await expect(db.as(owner, `update public.ingredients set pack_unit = 'ถุง', pack_size = 0 where id = $1`, [shop.sugar])).rejects.toThrow();
  });
});

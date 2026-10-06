import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { costRecipe } from '@/domain/costing';

describe.skipIf(!hasDb)('Phase 2–3: catalog, recipes, costing', () => {
  let db: TestDb;
  let manager: string, cashier: string;
  let productId: string;
  const ing: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDb();
    manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER');
    ({ id: productId } = await db.asOne<{ id: string }>(manager,
      `insert into public.products (name_th, price, inventory_mode) values ('คาราเมลคัสตาร์ด', 59, 'RECIPE') returning id`));
    // avg_cost normally comes from purchases (phase 4); set directly as superuser for this test
    for (const [key, unit, cost] of [['egg', 'ฟอง', 4.5], ['milk', 'มล.', 0.055], ['sugar', 'กรัม', 0.03], ['cream', 'กรัม', 0.16]] as const) {
      const row = await db.adminOne<{ id: string }>(
        `insert into public.ingredients (name_th, unit, avg_cost) values ($1, $2, $3) returning id`, [key, unit, cost]);
      ing[key] = row.id;
    }
  });
  afterAll(() => db?.destroy());

  const items = () => JSON.stringify([
    { ingredient_id: ing.egg, quantity: 10 }, { ingredient_id: ing.milk, quantity: 1000 },
    { ingredient_id: ing.sugar, quantity: 200 }, { ingredient_id: ing.cream, quantity: 250 },
  ]);

  it('saves a recipe and versions it on every save', async () => {
    const v1 = await db.asOne<{ id: string }>(manager,
      `select public.save_recipe($1, 'สูตรหลัก', 12, 'ชิ้น', 1, $2::jsonb) as id`, [productId, items()]);
    const v2 = await db.asOne<{ id: string }>(manager,
      `select public.save_recipe($1, 'สูตรหลัก', 12, 'ชิ้น', 1, $2::jsonb) as id`, [productId, items()]);
    expect(v1.id).not.toBe(v2.id);
    const rows = await db.admin<{ version: number; is_active: boolean }>(
      `select version, is_active from public.recipes where product_id = $1 order by version`, [productId]);
    expect(rows).toEqual([{ version: 1, is_active: false }, { version: 2, is_active: true }]);
    const audit = await db.admin(`select 1 from public.audit_logs where action = 'SAVE_RECIPE'`);
    expect(audit).toHaveLength(2);
  });

  it('rejects invalid recipes and non-managers', async () => {
    const dup = JSON.stringify([{ ingredient_id: ing.egg, quantity: 1 }, { ingredient_id: ing.egg, quantity: 2 }]);
    await expect(db.as(manager, `select public.save_recipe($1, 'x', 12, 'ชิ้น', 1, $2::jsonb)`, [productId, dup])).rejects.toThrow(/duplicate/);
    await expect(db.as(manager, `select public.save_recipe($1, 'x', 0, 'ชิ้น', 1, $2::jsonb)`, [productId, items()])).rejects.toThrow(/VALIDATION/);
    await expect(db.as(manager, `select public.save_recipe($1, 'x', 12, 'ชิ้น', 1, '[]'::jsonb)`, [productId])).rejects.toThrow(/at least one/);
    const neg = JSON.stringify([{ ingredient_id: ing.egg, quantity: -1 }]);
    await expect(db.as(manager, `select public.save_recipe($1, 'x', 12, 'ชิ้น', 1, $2::jsonb)`, [productId, neg])).rejects.toThrow(/positive/);
    await expect(db.as(cashier, `select public.save_recipe($1, 'x', 12, 'ชิ้น', 1, $2::jsonb)`, [productId, items()])).rejects.toThrow(/permission denied/);
    // failed saves must not have deactivated the current version
    const active = await db.admin(`select 1 from public.recipes where product_id = $1 and is_active`, [productId]);
    expect(active).toHaveLength(1);
  });

  it('cost view matches the TypeScript costing engine', async () => {
    const view = await db.asOne<Record<string, string>>(manager,
      `select recipe_cost, cost_per_yield, cost_per_selling_unit, gross_profit, gross_margin
       from public.recipe_costs where product_id = $1 and is_active`, [productId]);
    const ts = costRecipe({
      yieldQuantity: 12, unitsPerSale: 1,
      lines: [
        { ingredientId: 'egg', quantity: 10, unitCost: 4.5 }, { ingredientId: 'milk', quantity: 1000, unitCost: 0.055 },
        { ingredientId: 'sugar', quantity: 200, unitCost: 0.03 }, { ingredientId: 'cream', quantity: 250, unitCost: 0.16 },
      ],
    }, 59);
    expect(Number(view.recipe_cost)).toBe(ts.recipeCost);
    expect(Number(view.cost_per_yield)).toBe(ts.costPerYield);
    expect(Number(view.cost_per_selling_unit)).toBe(ts.costPerSellingUnit);
    expect(Number(view.gross_profit)).toBe(ts.grossProfit);
    expect(Number(view.gross_margin)).toBe(ts.grossMargin);
  });

  it('applies VAT-inclusive net price in the views', async () => {
    await db.admin(`update public.settings set value = 'true' where key = 'vat_enabled'`);
    const v = await db.asOne<{ net_price: string }>(manager, `select net_price from public.product_costs where product_id = $1`, [productId]);
    expect(Number(v.net_price)).toBeCloseTo(55.1402, 4);
    await db.admin(`update public.settings set value = 'false' where key = 'vat_enabled'`);
  });

  it('creates a finished-goods stock item for FINISHED_GOOD products', async () => {
    const p = await db.asOne<{ id: string }>(manager,
      `insert into public.products (name_th, price, inventory_mode, sku) values ('สังขยาฟักทอง', 45, 'FINISHED_GOOD', 'C01') returning id`);
    const fg = await db.adminOne<{ item_type: string; sku: string; name_th: string }>(
      `select item_type, sku, name_th from public.ingredients where product_id = $1`, [p.id]);
    expect(fg).toEqual({ item_type: 'FINISHED', sku: 'FG-C01', name_th: 'สังขยาฟักทอง' });
    await db.as(manager, `update public.products set name_th = 'สังขยาฟักทองชิ้น' where id = $1`, [p.id]);
    expect((await db.adminOne<{ name_th: string }>(`select name_th from public.ingredients where product_id = $1`, [p.id])).name_th)
      .toBe('สังขยาฟักทองชิ้น');
  });

  it('blocks a recipe from consuming its own finished good', async () => {
    const p = await db.asOne<{ id: string }>(manager,
      `insert into public.products (name_th, price, inventory_mode) values ('ทาร์ตไข่', 25, 'FINISHED_GOOD') returning id`);
    const fg = await db.adminOne<{ id: string }>(`select id from public.ingredients where product_id = $1`, [p.id]);
    await expect(db.as(manager, `select public.save_recipe($1, 'x', 12, 'ชิ้น', 1, $2::jsonb)`,
      [p.id, JSON.stringify([{ ingredient_id: fg.id, quantity: 1 }])])).rejects.toThrow(/own finished good/);
  });

  it('lets cashiers read costs only through RLS-scoped views', async () => {
    const rows = await db.as(cashier, `select * from public.recipe_costs`);
    expect(rows.length).toBeGreaterThan(0);
    const kitchen = await db.createEmployee('KITCHEN');
    expect(await db.as(kitchen, `select * from public.recipe_costs`)).toHaveLength(0);
  });
});

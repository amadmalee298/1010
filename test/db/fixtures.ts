import type { TestDb } from './harness';

/** A small shop: ingredients with stock + cost, recipe products, a finished good, a customer, promotions. */
export async function seedShop(db: TestDb, managerId: string) {
  const ing = async (name: string, unit: string, qty: number, cost: number) => {
    const row = await db.asOne<{ id: string }>(managerId, `insert into public.ingredients (name_th, unit) values ($1, $2) returning id`, [name, unit]);
    await db.as(managerId, `select public.adjust_stock($1, $2, $3, 'opening')`, [row.id, qty, cost]);
    return row.id;
  };
  const egg = await ing('ไข่ไก่', 'ฟอง', 100, 4);
  const milk = await ing('นมสด', 'มล.', 10000, 0.05);
  const sugar = await ing('น้ำตาล', 'กรัม', 5000, 0.03);

  const product = async (name: string, price: number, mode: 'RECIPE' | 'FINISHED_GOOD' | 'NONE' = 'RECIPE') =>
    (await db.asOne<{ id: string }>(managerId,
      `insert into public.products (name_th, price, inventory_mode) values ($1, $2, $3) returning id`, [name, price, mode])).id;

  // Caramel custard: batch of 12 uses 12 eggs, 1200 ml milk, 240 g sugar → per piece 1 egg, 100 ml, 20 g = 4 + 5 + 0.6 = 9.60
  const custard = await product('คาราเมลคัสตาร์ด', 59);
  await db.as(managerId, `select public.save_recipe($1, 'v', 12, 'ชิ้น', 1, $2::jsonb)`, [custard, JSON.stringify([
    { ingredient_id: egg, quantity: 12 }, { ingredient_id: milk, quantity: 1200 }, { ingredient_id: sugar, quantity: 240 },
  ])]);
  // Box of 4 uses the same recipe with units_per_sale = 4
  const box = await product('คัสตาร์ดกล่อง 4', 199);
  await db.as(managerId, `select public.save_recipe($1, 'v', 12, 'ชิ้น', 4, $2::jsonb)`, [box, JSON.stringify([
    { ingredient_id: egg, quantity: 12 }, { ingredient_id: milk, quantity: 1200 }, { ingredient_id: sugar, quantity: 240 },
  ])]);
  const tart = await product('ทาร์ตไข่', 25, 'FINISHED_GOOD');
  const tartItem = (await db.adminOne<{ id: string }>(`select id from public.ingredients where product_id = $1`, [tart])).id;
  const water = await product('น้ำเปล่า', 10, 'NONE');
  const noRecipe = await product('เมนูใหม่', 30, 'RECIPE');

  const customer = (await db.asOne<{ id: string }>(managerId,
    `insert into public.customers (name, phone) values ('สมใจ', '0891112222') returning id`)).id;
  const promo10 = (await db.asOne<{ id: string }>(managerId,
    `insert into public.promotions (name, code, discount_type, value, max_discount) values ('ลด 10%', 'TEN', 'PERCENT', 10, 50) returning id`)).id;
  const membersPromo = (await db.asOne<{ id: string }>(managerId,
    `insert into public.promotions (name, discount_type, value, members_only, min_subtotal) values ('สมาชิกลด 20', 'FIXED', 20, true, 100) returning id`)).id;

  return { egg, milk, sugar, custard, box, tart, tartItem, water, noRecipe, customer, promo10, membersPromo };
}

export async function openSession(db: TestDb, userId: string, openingCash = 1000): Promise<string> {
  return (await db.asOne<{ id: string }>(userId, `select id from public.open_cash_session($1, null)`, [openingCash])).id;
}

export const stockOf = async (db: TestDb, id: string) =>
  Number((await db.adminOne<{ stock_qty: string }>('select stock_qty from public.ingredients where id = $1', [id])).stock_qty);

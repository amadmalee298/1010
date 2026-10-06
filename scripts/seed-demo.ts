/**
 * Seeds a demo Custard shop into a Supabase project (local or staging — never production).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... npm run seed:demo
 *
 * Staff accounts are created with the Auth Admin API; everything else is created by
 * signing in as the demo manager, so the seed goes through RLS and the business RPCs
 * exactly like the app does.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/database.types';

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY');

const PASSWORD = process.env.DEMO_PASSWORD ?? 'custard1234';
const admin = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });

function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error || res.data === null || res.data === undefined) throw new Error(`${what}: ${res.error?.message ?? 'no data'}`);
  return res.data;
}

async function ensureUser(email: string, role: 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN', name: string) {
  const list = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (list.error) throw new Error(`list users: ${list.error.message}`);
  let user = list.data.users.find((u) => u.email === email);
  if (!user) {
    const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`create ${email}: ${created.error?.message ?? 'no user'}`);
    user = created.data.user;
  }
  const roleRow = must(await admin.from('roles').select('id').eq('code', role).single(), 'role');
  const existing = await admin.from('employees').select('id').eq('user_id', user.id).maybeSingle();
  if (!existing.data) must(await admin.from('employees').insert({ user_id: user.id, role_id: roleRow.id, display_name: name }).select().single(), 'employee');
  return user.id;
}

async function main() {
  await ensureUser('owner@custard.test', 'OWNER', 'เจ้าของร้าน');
  await ensureUser('manager@custard.test', 'MANAGER', 'ผู้จัดการ');
  await ensureUser('cashier@custard.test', 'CASHIER', 'แคชเชียร์');
  await ensureUser('kitchen@custard.test', 'KITCHEN', 'ครัว');

  const db = createClient<Database>(url!, anonKey!, { auth: { persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email: 'manager@custard.test', password: PASSWORD });
  if (signIn.error) throw new Error(`sign in manager: ${signIn.error.message}`);

  const already = must(await db.from('products').select('id').limit(1), 'check products');
  if (already.length) { console.log('Catalog already seeded — skipping.'); return; }

  // Ingredients with opening stock (adjust_stock posts ADJUSTMENT ledger rows with cost)
  const ingredients: [string, string, number, number, number][] = [
    ['ไข่ไก่', 'ฟอง', 300, 4.2, 60], ['นมสด', 'มล.', 12000, 0.055, 2000], ['น้ำตาลทราย', 'กรัม', 8000, 0.03, 1500],
    ['วิปปิ้งครีม', 'มล.', 4000, 0.16, 1000], ['วานิลลา', 'มล.', 300, 2, 50], ['คาราเมล', 'กรัม', 3000, 0.08, 500],
    ['กะทิ', 'มล.', 8000, 0.06, 1500], ['น้ำตาลมะพร้าว', 'กรัม', 5000, 0.08, 1000], ['ใบเตย', 'กรัม', 800, 0.1, 150],
    ['ฟักทอง', 'กรัม', 15000, 0.04, 3000], ['ขนมปัง', 'แผ่น', 120, 2.5, 30], ['แป้งทาร์ต', 'ชิ้น', 80, 3, 20],
    ['ถ้วย/กล่อง', 'ใบ', 500, 1.5, 100],
  ];
  const ing: Record<string, string> = {};
  for (const [name, unit, qty, cost, reorder] of ingredients) {
    const row = must(await db.from('ingredients').insert({ name_th: name, unit, reorder_level: reorder }).select('id').single(), name);
    ing[name] = row.id;
    must(await db.rpc('adjust_stock', { p_ingredient_id: row.id, p_delta: qty, p_unit_cost: cost, p_note: 'ยอดยกมา (demo)' }), `stock ${name}`);
  }

  const cat = async (name: string, sort: number) => must(await db.from('categories').insert({ name_th: name, sort_order: sort }).select('id').single(), name).id;
  const custard = await cat('คัสตาร์ด / สังขยา', 1);
  const toast = await cat('ปังสังขยา', 2);
  const bakery = await cat('ทาร์ต / เบเกอรี่', 3);

  const product = async (name: string, price: number, category: string, mode: 'RECIPE' | 'FINISHED_GOOD', sku: string) =>
    must(await db.from('products').insert({ name_th: name, price, category_id: category, inventory_mode: mode, sku }).select('id').single(), name).id;
  const recipe = async (productId: string, yieldQty: number, unitsPerSale: number, items: [string, number][]) =>
    must(await db.rpc('save_recipe', {
      p_product_id: productId, p_name: 'สูตรมาตรฐาน', p_yield_quantity: yieldQty, p_yield_unit: 'ชิ้น', p_units_per_sale: unitsPerSale,
      p_items: items.map(([n, q]) => ({ ingredient_id: ing[n], quantity: q })),
    }), `recipe ${productId}`);

  const caramel = await product('คาราเมลคัสตาร์ด', 59, custard, 'RECIPE', 'C01');
  await recipe(caramel, 12, 1, [['ไข่ไก่', 10], ['นมสด', 1000], ['น้ำตาลทราย', 200], ['วิปปิ้งครีม', 250], ['วานิลลา', 5], ['คาราเมล', 150], ['ถ้วย/กล่อง', 12]]);
  const box = await product('คาราเมลคัสตาร์ด กล่อง 4', 219, custard, 'RECIPE', 'C02');
  await recipe(box, 12, 4, [['ไข่ไก่', 10], ['นมสด', 1000], ['น้ำตาลทราย', 200], ['วิปปิ้งครีม', 250], ['วานิลลา', 5], ['คาราเมล', 150], ['ถ้วย/กล่อง', 3]]);
  const pandan = await product('สังขยาใบเตย', 39, custard, 'RECIPE', 'C03');
  await recipe(pandan, 10, 1, [['ไข่ไก่', 8], ['กะทิ', 600], ['น้ำตาลมะพร้าว', 250], ['ใบเตย', 40], ['ถ้วย/กล่อง', 10]]);
  const pumpkin = await product('สังขยาฟักทอง', 45, custard, 'FINISHED_GOOD', 'C04');
  await recipe(pumpkin, 8, 1, [['ฟักทอง', 1500], ['ไข่ไก่', 8], ['กะทิ', 400], ['น้ำตาลมะพร้าว', 200]]);
  const bread = await product('ปังสังขยาจิ้ม', 49, toast, 'RECIPE', 'B01');
  await recipe(bread, 1, 1, [['ขนมปัง', 2], ['ไข่ไก่', 1], ['กะทิ', 50], ['น้ำตาลมะพร้าว', 20], ['ถ้วย/กล่อง', 1]]);
  const tart = await product('ทาร์ตไข่', 25, bakery, 'FINISHED_GOOD', 'T01');
  await recipe(tart, 12, 1, [['แป้งทาร์ต', 12], ['ไข่ไก่', 6], ['นมสด', 300], ['น้ำตาลทราย', 120]]);

  must(await db.from('customers').insert([{ name: 'คุณสมใจ', phone: '0891112222' }, { name: 'คุณมานี', phone: '0823334444' }]).select(), 'customers');
  must(await db.from('promotions').insert([
    { name: 'สมาชิกลด 10%', code: 'MEMBER10', discount_type: 'PERCENT', value: 10, min_subtotal: 0, max_discount: 100, members_only: true },
    { name: 'ซื้อครบ 300 ลด 30', code: 'SAVE30', discount_type: 'FIXED', value: 30, min_subtotal: 300, max_discount: null, members_only: false },
  ]).select(), 'promotions');

  console.log(`Seeded demo shop. Staff logins (password: ${PASSWORD}): owner@ / manager@ / cashier@ / kitchen@custard.test`);
  void pumpkin; void tart;
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });

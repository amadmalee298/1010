import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';

describe.skipIf(!hasDb)('Phase 1: schema, RLS, audit', () => {
  let db: TestDb;
  let owner: string, manager: string, cashier: string, kitchen: string, outsider: string;

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER');
    manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER');
    kitchen = await db.createEmployee('KITCHEN');
    // authenticated, but not an employee
    ({ id: outsider } = await db.adminOne<{ id: string }>(`insert into auth.users (email) values ('x@test.local') returning id`));
  });
  afterAll(() => db?.destroy());

  it('mirrors auth.users into public.users', async () => {
    const rows = await db.admin('select 1 from public.users where id = $1', [cashier]);
    expect(rows).toHaveLength(1);
  });

  it('resolves the caller role', async () => {
    const r = await db.asOne<{ role: string }>(cashier, 'select public.current_app_role() as role');
    expect(r.role).toBe('CASHIER');
    const n = await db.asOne<{ role: string | null }>(outsider, 'select public.current_app_role() as role');
    expect(n.role).toBeNull();
  });

  it('hides everything from anonymous users and non-employees', async () => {
    await expect(db.as(null, 'select * from public.products')).rejects.toThrow(/permission denied/);
    expect(await db.as(outsider, 'select * from public.settings')).toHaveLength(0);
  });

  it('lets managers but not cashiers create products', async () => {
    const p = await db.asOne<{ id: string }>(manager, `insert into public.products (name_th, price) values ('คัสตาร์ด', 45) returning id`);
    expect(p.id).toMatch(/[0-9a-f-]{36}/);
    await expect(db.as(cashier, `insert into public.products (name_th, price) values ('x', 1)`)).rejects.toThrow(/row-level security/);
    // cashier update silently affects 0 rows under RLS
    const res = await db.as(cashier, `update public.products set price = 1 returning id`);
    expect(res).toHaveLength(0);
  });

  it('never allows direct stock or cost edits, even for the owner', async () => {
    const i = await db.asOne<{ id: string }>(owner, `insert into public.ingredients (name_th, unit) values ('ไข่ไก่', 'ฟอง') returning id`);
    await expect(db.as(owner, `update public.ingredients set stock_qty = 100 where id = $1`, [i.id])).rejects.toThrow(/permission denied/);
    await expect(db.as(manager, `update public.ingredients set avg_cost = 9 where id = $1`, [i.id])).rejects.toThrow(/permission denied/);
    await db.as(manager, `update public.ingredients set reorder_level = 30 where id = $1`, [i.id]);
  });

  it('blocks cashiers and kitchen from management data', async () => {
    expect(await db.as(cashier, 'select * from public.suppliers')).toHaveLength(0);
    expect(await db.as(kitchen, 'select * from public.customers')).toHaveLength(0);
    await expect(db.as(cashier, `insert into public.orders (order_number, queue_number, business_date, subtotal, total) values ('X',1,current_date,1,1)`))
      .rejects.toThrow(/permission denied/);
  });

  it('writes audit logs for master-data mutations and keeps them immutable', async () => {
    const p = await db.asOne<{ id: string }>(manager, `insert into public.categories (name_th) values ('สังขยา') returning id`);
    await db.as(manager, `update public.categories set name_th = 'สังขยาไทย' where id = $1`, [p.id]);
    const logs = await db.admin<{ action: string; user_id: string; old_value: { name_th: string } | null }>(
      `select action, user_id, old_value from public.audit_logs where entity = 'categories' and entity_id = $1 order by created_at`, [p.id]);
    expect(logs.map((l) => l.action)).toEqual(['INSERT', 'UPDATE']);
    expect(logs[1]?.user_id).toBe(manager);
    expect(logs[1]?.old_value?.name_th).toBe('สังขยา');
    await expect(db.admin(`delete from public.audit_logs`)).rejects.toThrow(/append-only/);
    expect(await db.as(manager, 'select * from public.audit_logs')).toHaveLength(0);
    expect((await db.as(owner, 'select * from public.audit_logs')).length).toBeGreaterThan(0);
  });

  it('enforces one active recipe per product', async () => {
    const p = await db.asOne<{ id: string }>(manager, `insert into public.products (name_th, price) values ('พุดดิ้ง', 49) returning id`);
    await db.as(manager, `insert into public.recipes (product_id, name, yield_quantity) values ($1, 'v1', 12)`, [p.id]);
    await expect(db.as(manager, `insert into public.recipes (product_id, name, yield_quantity) values ($1, 'v2', 12)`, [p.id]))
      .rejects.toThrow(/recipes_one_active_per_product/);
  });

  it('only the owner manages settings and employees', async () => {
    expect(await db.as(manager, `update public.settings set value = '"x"' where key = 'shop_name' returning id`)).toHaveLength(0);
    expect(await db.as(owner, `update public.settings set value = '"Custard BKK"' where key = 'shop_name' returning id`)).toHaveLength(1);
    expect(await db.as(cashier, 'select * from public.employees')).toHaveLength(1); // only self
  });
});

describe.skipIf(!hasDb)('Phase 1: first owner bootstrap', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(() => db?.destroy());

  it('lets exactly one first user claim OWNER', async () => {
    const a = await db.adminOne<{ id: string }>(`insert into auth.users (email) values ('a@test.local') returning id`);
    const b = await db.adminOne<{ id: string }>(`insert into auth.users (email) values ('b@test.local') returning id`);
    await db.as(a.id, `select public.claim_first_owner('เจ้าของ')`);
    expect((await db.asOne<{ r: string }>(a.id, 'select public.current_app_role() as r')).r).toBe('OWNER');
    await expect(db.as(b.id, `select public.claim_first_owner('x')`)).rejects.toThrow(/INVALID_STATE/);
    await expect(db.as(null, `select public.claim_first_owner('x')`)).rejects.toThrow(/permission denied/);
  });
});

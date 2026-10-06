import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';

describe.skipIf(!hasDb)('Phase 12: administration', () => {
  let db: TestDb;
  let owner: string, manager: string;
  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER');
    manager = await db.createEmployee('MANAGER');
  });
  afterAll(() => db?.destroy());

  it('never lets the last active owner be deactivated or demoted', async () => {
    await expect(db.as(owner, `update public.employees set is_active = false where user_id = $1`, [owner])).rejects.toThrow(/active owner/);
    await expect(db.as(owner, `update public.employees set role_id = (select id from public.roles where code = 'CASHIER') where user_id = $1`, [owner]))
      .rejects.toThrow(/active owner/);
    const second = await db.createEmployee('OWNER', 'Owner 2');
    await db.as(owner, `update public.employees set is_active = false where user_id = $1`, [second]);
  });

  it('lets only the owner manage employees and see the directory', async () => {
    await expect(db.as(manager, `update public.employees set display_name = 'x' where user_id = $1 returning id`, [owner])).resolves.toHaveLength(0);
    expect((await db.as(owner, `select * from public.employee_directory`)).length).toBe(3);
    expect((await db.as(manager, `select * from public.employee_directory`)).length).toBe(3); // managers may read staff
    const cashier = await db.createEmployee('CASHIER');
    expect(await db.as(cashier, `select * from public.employee_directory`)).toHaveLength(1);    // cashiers: self only
    await expect(db.as(manager, `insert into public.employees (role_id, display_name) select id, 'x' from public.roles where code = 'OWNER'`))
      .rejects.toThrow(/row-level security/);
  });

  it('records employee changes in the audit log', async () => {
    await db.as(owner, `update public.employees set display_name = 'ผู้จัดการใหม่' where user_id = $1`, [manager]);
    const log = await db.as<{ old_value: { display_name: string }; new_value: { display_name: string }; user_id: string }>(owner,
      `select old_value, new_value, user_id from public.audit_logs where entity = 'employees' and action = 'UPDATE' order by created_at desc limit 1`);
    expect(log[0]?.new_value.display_name).toBe('ผู้จัดการใหม่');
    expect(log[0]?.user_id).toBe(owner);
  });
});

describe.skipIf(!hasDb)('audit noise', () => {
  let db: TestDb;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(() => db?.destroy());
  it('does not log updates that only touch updated_at', async () => {
    const owner = await db.createEmployee('OWNER');
    const before = (await db.admin(`select 1 from public.audit_logs where entity = 'settings'`)).length;
    await db.as(owner, `update public.settings set updated_at = now() where key = 'shop_name'`);
    expect((await db.admin(`select 1 from public.audit_logs where entity = 'settings'`)).length).toBe(before);
    await db.as(owner, `update public.settings set value = '"Custard 2"' where key = 'shop_name'`);
    expect((await db.admin(`select 1 from public.audit_logs where entity = 'settings'`)).length).toBe(before + 1);
  });
});

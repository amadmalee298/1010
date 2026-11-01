import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { seedShop } from './fixtures';

const migration = readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'migrations', '20261006001800_phase22_real_names.sql'), 'utf8');

describe.skipIf(!hasDb)('Phase 22: real names backfill', () => {
  let db: TestDb;
  let owner: string, cashier: string, cashierEmployee: string;
  let update = 900;

  const approved = async () => {
    const b = await db.adminOne<{ id: string }>(
      `select id from public.submit_bill($1, 91, $2, false, null, 'นม 100', $3::jsonb, null, null, null, 100)`,
      [update++, cashierEmployee, JSON.stringify({ is_bill: false, lines: [{ description: 'นม', amount: 100 }] })]);
    await db.as(owner, `select public.approve_bill($1, null, null, '[{"description":"นม","amount":100}]'::jsonb, 'วัตถุดิบ', 'TRANSFER', false)`, [b.id]);
    return b.id;
  };
  const names = (id: string) =>
    db.adminOne<{ payer_name: string; approver_name: string }>(`select payer_name, approver_name from public.bill_submissions where id = $1`, [id]);

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER', 'kameenee.sa');
    cashier = await db.createEmployee('CASHIER', 'aa');
    cashierEmployee = (await db.adminOne<{ id: string }>(`select id from public.employees where user_id = $1`, [cashier])).id;
    await seedShop(db, owner);
  });
  afterAll(() => db?.destroy());

  it('sets the owner legal name and replaces nicknames on issued receipts, keeping hand-typed names', async () => {
    const plain = await approved();
    const typed = await approved();
    await db.admin(`update public.bill_submissions set payer_name = 'นางสาว ทดสอบ' where id = $1`, [typed]);
    expect((await names(plain)).approver_name).toBe('kameenee.sa');

    await db.admin(`update public.employees set legal_name = 'อาห์มัด มะหลี' where user_id = $1`, [cashier]);
    await db.admin(migration);

    const o = await db.adminOne<{ legal_name: string }>(`select legal_name from public.employees where user_id = $1`, [owner]);
    expect(o.legal_name).toBe('กามีนี สาและ');
    expect(await names(plain)).toEqual({ payer_name: 'อาห์มัด มะหลี', approver_name: 'กามีนี สาและ' });
    expect(await names(typed)).toEqual({ payer_name: 'นางสาว ทดสอบ', approver_name: 'กามีนี สาและ' });

    // a legal name already set is never overwritten
    await db.admin(`update public.employees set legal_name = 'ชื่ออื่น' where user_id = $1`, [owner]);
    await db.admin(migration);
    expect((await db.adminOne<{ legal_name: string }>(`select legal_name from public.employees where user_id = $1`, [owner])).legal_name).toBe('ชื่ออื่น');
  });
});

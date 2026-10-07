import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { openSession, seedShop, stockOf } from './fixtures';

type Bill = { id: string; submission_number: string; payer_name: string; approver_name: string; approved_lines: { description: string; note?: string; amount: number }[]; voided_at: string | null; substitute_url: string | null };
const n = (v: unknown) => Number(v ?? 0);

describe.skipIf(!hasDb)('Phase 16: bill corrections and evidence', () => {
  let db: TestDb;
  let owner: string, manager: string, cashier: string;
  let cashierEmployee: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;
  let today: string;
  let update = 100;

  const submit = async (hasReceipt: boolean) => db.adminOne<{ id: string }>(
    `select id from public.submit_bill($1, 1, $2, $3, $4, 'x', null, null, null, null, null)`,
    [update++, cashierEmployee, hasReceipt, hasReceipt ? 'bills/x.jpg' : null]);
  const balance = async (code: string) =>
    n((await db.asOne<{ b: string }>(owner, `select balance as b from public.report_trial_balance($1) where account_code = $2`, [today, code])).b);

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER', 'kameenee.sa');
    manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER', 'aa');
    cashierEmployee = (await db.adminOne<{ id: string }>(`select id from public.employees where user_id = $1`, [cashier])).id;
    await db.as(owner, `update public.employees set legal_name = 'กามีนี สาและ' where user_id = $1`, [owner]);
    await db.as(owner, `update public.employees set legal_name = 'อาห์มัด มะหลี' where user_id = $1`, [cashier]);
    shop = await seedShop(db, manager);
    today = (await db.adminOne<{ d: string }>(`select public.bkk_date(now())::text as d`)).d;
  });
  afterAll(() => db?.destroy());

  it('prints real names: payer from the submitter, approver from whoever approves', async () => {
    const b = await submit(false);
    const r = await db.asOne<Bill>(owner, `select * from public.approve_bill($1, null, null, $2::jsonb, 'อื่น ๆ', 'CASH', false)`,
      [b.id, JSON.stringify([{ description: 'นมเมจิ 2000ml', amount: 200 }])]);
    expect(r.payer_name).toBe('อาห์มัด มะหลี');
    expect(r.approver_name).toBe('กามีนี สาและ');
    expect(r.approved_lines[0]?.note).toBeUndefined();
  });

  it('edits the wording of a substitute receipt but never the amounts', async () => {
    const b = await submit(false);
    await db.as(owner, `select public.approve_bill($1, null, null, $2::jsonb, 'อื่น ๆ', 'CASH', false)`,
      [b.id, JSON.stringify([{ description: 'นม', amount: 200 }, { description: 'ไข่', amount: 100 }])]);
    await db.as(owner, `select public.set_bill_links($1, null, 'https://drive/old')`, [b.id]);
    const e = await db.asOne<Bill>(manager, `select * from public.edit_substitute($1, $2, 'อาห์มัด มะหลี', 'กามีนี สาและ', $3::jsonb)`,
      [b.id, today, JSON.stringify([{ description: 'นมเมจิ 2000ml', note: 'ซื้อด่วน', amount: 9999 }, { description: 'ไข่ไก่', note: '' }])]);
    expect(e.approved_lines.map((l) => [l.description, l.note ?? null, n(l.amount)])).toEqual([['นมเมจิ 2000ml', 'ซื้อด่วน', 200], ['ไข่ไก่', null, 100]]);
    expect(e.substitute_url).toBeNull(); // must be filed again
    await expect(db.as(manager, `select public.edit_substitute($1, null, 'x', null, '[{"description":"a"}]'::jsonb)`, [b.id]))
      .rejects.toThrow(/must match/);
    await expect(db.as(cashier, `select public.edit_substitute($1, null, 'x', null, '[]'::jsonb)`, [b.id])).rejects.toThrow(/permission denied/);
  });

  it('voids a transfer-paid bill: stock out, expense voided, ledger still balanced', async () => {
    const eggs = await stockOf(db, shop.egg);
    const bank = await balance('1010');
    const b = await submit(true);
    await db.as(manager, `select public.approve_bill($1, null, null, $2::jsonb, 'บรรจุภัณฑ์', 'TRANSFER', false)`, [b.id, JSON.stringify([
      { description: 'ไข่', amount: 120, ingredient_id: shop.egg, quantity: 30 }, { description: 'ถุง', amount: 40 }])]);
    expect(await stockOf(db, shop.egg)).toBe(eggs + 30);
    expect(await balance('1010')).toBeCloseTo(bank - 160, 2);
    const v = await db.asOne<Bill>(manager, `select * from public.void_bill($1, 'ส่งซ้ำ')`, [b.id]);
    expect(v.voided_at).not.toBeNull();
    expect(await stockOf(db, shop.egg)).toBe(eggs);
    expect(await balance('1010')).toBeCloseTo(bank, 2);
    const exp = await db.adminOne<{ voided_at: string | null }>(`select voided_at from public.expenses where id = (select expense_id from public.bill_submissions where id = $1)`, [b.id]);
    expect(exp.voided_at).not.toBeNull();
    const bs = (await db.asOne<{ r: { difference: string } }>(owner, `select public.report_balance_sheet($1) as r`, [today])).r;
    expect(n(bs.difference)).toBeCloseTo(0, 2);
    expect(await balance('1190')).toBeCloseTo(0, 2);
    await expect(db.as(manager, `select public.void_bill($1, 'x')`, [b.id])).rejects.toThrow(/INVALID_STATE/);
    await expect(db.as(manager, `select public.edit_substitute($1, null, 'x', null, '[]'::jsonb)`, [b.id])).rejects.toThrow(/INVALID_STATE/);
  });

  it('voids a drawer-paid bill by putting the cash back into the open drawer', async () => {
    await openSession(db, cashier, 500);
    const b = await submit(true);
    await db.as(manager, `select public.approve_bill($1, null, null, $2::jsonb, 'บรรจุภัณฑ์', 'CASH', true)`, [b.id, JSON.stringify([
      { description: 'นม', amount: 50, ingredient_id: shop.milk, quantity: 1000 }, { description: 'ถุง', amount: 10 }])]);
    const before = await db.adminOne<{ e: string }>(`select expected_cash as e from public.cash_session_summary where status = 'OPEN'`);
    await db.as(manager, `select public.void_bill($1, 'ผิดร้าน')`, [b.id]);
    const after = await db.adminOne<{ e: string }>(`select expected_cash as e from public.cash_session_summary where status = 'OPEN'`);
    expect(n(after.e) - n(before.e)).toBe(60);
    expect(await balance('1190')).toBeCloseTo(0, 2);
  });

  it('attaches evidence from the app (managers) and from Telegram (submitter or managers)', async () => {
    const b = await submit(true);
    const a = await db.asOne<{ kind: string }>(manager, `select * from public.add_bill_attachment($1, 'slip', 'bills/2026-10/slip-1.jpg')`, [b.id]);
    expect(a.kind).toBe('SLIP');
    await expect(db.as(manager, `select public.add_bill_attachment($1, 'slip', '../etc/passwd')`, [b.id])).rejects.toThrow(/invalid path/);
    await expect(db.as(cashier, `select public.add_bill_attachment($1, 'slip', 'bills/a.jpg')`, [b.id])).rejects.toThrow(/permission denied/);

    const { code } = await db.asOne<{ code: string }>(cashier, `select public.create_telegram_link_code() as code`);
    await db.admin(`select public.telegram_link_account($1, 77, 77, null)`, [code]);
    const num = (await db.adminOne<{ s: string }>(`select submission_number as s from public.bill_submissions where id = $1`, [b.id])).s;
    await db.admin(`select public.telegram_add_attachment(77, $1, 'bills/2026-10/ev.jpg')`, [num]);
    const other = await db.createEmployee('CASHIER');
    const { code: c2 } = await db.asOne<{ code: string }>(other, `select public.create_telegram_link_code() as code`);
    await db.admin(`select public.telegram_link_account($1, 78, 78, null)`, [c2]);
    await expect(db.admin(`select public.telegram_add_attachment(78, $1, 'bills/x.jpg')`, [num])).rejects.toThrow(/NOT_FOUND/);
    expect((await db.as(cashier, `select * from public.bill_attachments where bill_id = $1`, [b.id])).length).toBe(2);
    expect(await db.as(other, `select * from public.bill_attachments where bill_id = $1`, [b.id])).toEqual([]);
  });
});

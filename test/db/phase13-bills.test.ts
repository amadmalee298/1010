import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { openSession, seedShop, stockOf } from './fixtures';

type Bill = { id: string; status: string; submission_number: string; substitute_number: string | null; total: string | null; expense_id: string | null };

describe.skipIf(!hasDb)('Phase 13: bill inbox (Telegram → approval)', () => {
  let db: TestDb;
  let owner: string, manager: string, cashier: string;
  let cashierEmployee: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;
  let update = 1000;

  const submit = async (hasReceipt: boolean, text: string | null = null) =>
    db.adminOne<Bill>(
      `select * from public.submit_bill($1, 555, $2, $3, $4, $5, '{"items":[]}'::jsonb, null, 'ตลาด', '2026-10-06', 1060)`,
      [update++, cashierEmployee, hasReceipt, hasReceipt ? 'bills/x.jpg' : null, text]);

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER');
    manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER', 'อาห์มัด');
    cashierEmployee = (await db.adminOne<{ id: string }>(`select id from public.employees where user_id = $1`, [cashier])).id;
    shop = await seedShop(db, manager);
  });
  afterAll(() => db?.destroy());

  it('links a Telegram account with a one-time code', async () => {
    const { code } = await db.asOne<{ code: string }>(cashier, `select public.create_telegram_link_code() as code`);
    expect(code).toMatch(/^[A-Z0-9]{8}$/);
    const { name } = await db.adminOne<{ name: string }>(`select public.telegram_link_account($1, 42, 4242, 'ahmad') as name`, [code.toLowerCase()]);
    expect(name).toBe('อาห์มัด');
    const who = await db.admin<{ employee_id: string }>(`select * from public.telegram_employee(42)`);
    expect(who).toEqual([expect.objectContaining({ employee_id: cashierEmployee })]);
    // the code is single-use
    await expect(db.admin(`select public.telegram_link_account($1, 43, 4343, null)`, [code])).rejects.toThrow(/NOT_FOUND: link code/);
  });

  it('keeps webhook functions away from signed-in users', async () => {
    for (const fn of ['telegram_link_account(text,bigint,bigint,text)', 'telegram_employee(bigint)',
      'submit_bill(bigint,bigint,uuid,boolean,text,text,jsonb,text,text,date,numeric)']) {
      const r = await db.adminOne<{ a: boolean; s: boolean }>(
        `select has_function_privilege('authenticated', 'public.${fn}', 'execute') as a,
                has_function_privilege('service_role', 'public.${fn}', 'execute') as s`);
      expect(r).toEqual({ a: false, s: true });
    }
  });

  it('stores submissions idempotently per Telegram update', async () => {
    const first = await db.adminOne<Bill>(
      `select * from public.submit_bill(1, 555, $1, false, null, 'ค่ากุ้งสด ปลาหมึก 1060', null, null, null, null, null)`, [cashierEmployee]);
    const again = await db.adminOne<Bill>(
      `select * from public.submit_bill(1, 555, $1, false, null, 'ค่ากุ้งสด ปลาหมึก 1060', null, null, null, null, null)`, [cashierEmployee]);
    expect(again.id).toBe(first.id);
    expect(first.submission_number).toMatch(/^BL\d{6}-0001$/);
    expect(first.status).toBe('PENDING');
  });

  it('lets managers see every bill and staff only their own', async () => {
    expect((await db.as(manager, `select id from public.bill_submissions`)).length).toBeGreaterThan(0);
    const other = await db.createEmployee('CASHIER');
    expect(await db.as(other, `select id from public.bill_submissions`)).toEqual([]);
    expect((await db.as(cashier, `select id from public.bill_submissions`)).length).toBeGreaterThan(0);
  });

  it('approves: ingredient lines go to stock at the bill cost, the rest becomes one expense', async () => {
    const bill = await submit(true);
    const eggs = await stockOf(db, shop.egg);
    const lines = [
      { description: 'ไข่ไก่ 30 ฟอง', amount: 150, ingredient_id: shop.egg, quantity: 30 },
      { description: 'ถุงพลาสติก', amount: 40 },
      { description: 'น้ำแข็ง', amount: 20 },
    ];
    const done = await db.asOne<Bill>(manager, `select * from public.approve_bill($1, '2026-10-06', 'ร้านป้าแดง', $2::jsonb, 'วัสดุสิ้นเปลือง')`,
      [bill.id, JSON.stringify(lines)]);
    expect(done.status).toBe('APPROVED');
    expect(Number(done.total)).toBe(210);
    expect(done.substitute_number).toBeNull(); // it had a receipt
    expect(await stockOf(db, shop.egg)).toBe(eggs + 30);
    const txn = await db.adminOne<{ unit_cost: string; reference_type: string }>(
      `select unit_cost, reference_type from public.inventory_transactions where reference_id = $1`, [bill.id]);
    expect(Number(txn.unit_cost)).toBe(5);
    expect(txn.reference_type).toBe('bill_submission');
    const exp = await db.adminOne<{ amount: string; category: string; description: string; receipt_path: string }>(
      `select * from public.expenses where id = $1`, [done.expense_id]);
    expect(Number(exp.amount)).toBe(60);
    expect(exp.category).toBe('วัสดุสิ้นเปลือง');
    expect(exp.description).toContain('ถุงพลาสติก, น้ำแข็ง');
    expect(exp.receipt_path).toBe('bills/x.jpg');
    await expect(db.as(manager, `select public.approve_bill($1, null, null, $2::jsonb, 'x')`, [bill.id, JSON.stringify(lines)]))
      .rejects.toThrow(/INVALID_STATE/);
  });

  it('numbers substitute receipts per Buddhist-era month for bills without a receipt', async () => {
    const a = await submit(false, 'ค่ากุ้งสด ปลาหมึก 1060');
    const b = await submit(false, 'ค่าแก๊ส 380');
    const line = (amount: number) => JSON.stringify([{ description: 'ค่ากุ้งสด ปลาหมึก', amount }]);
    const ra = await db.asOne<Bill>(manager, `select * from public.approve_bill($1, null, null, $2::jsonb, 'วัตถุดิบสด')`, [a.id, line(1060)]);
    const rb = await db.asOne<Bill>(manager, `select * from public.approve_bill($1, null, null, $2::jsonb, 'วัตถุดิบสด')`, [b.id, line(380)]);
    const { stem } = await db.adminOne<{ stem: string }>(
      `select (extract(year from public.bkk_date(now()))::int + 543)::text || '/' || to_char(public.bkk_date(now()), 'MM') || '-' as stem`);
    expect(ra.substitute_number).toBe(`${stem}001`);
    expect(rb.substitute_number).toBe(`${stem}002`);
  });

  it('pays from the drawer: expense and stock purchase both leave the cash session', async () => {
    const session = await openSession(db, manager, 2000);
    const bill = await submit(true);
    await db.as(manager, `select public.approve_bill($1, null, null, $2::jsonb, 'อื่นๆ', 'CASH', true)`, [bill.id, JSON.stringify([
      { description: 'นมสด', amount: 100, ingredient_id: shop.milk, quantity: 2000 },
      { description: 'ค่าส่ง', amount: 30 },
    ])]);
    const rows = await db.admin<{ transaction_type: string; amount: string }>(
      `select transaction_type, amount from public.cash_transactions where cash_session_id = $1 and transaction_type in ('EXPENSE','WITHDRAWAL') order by amount`, [session]);
    expect(rows.map((r) => [r.transaction_type, Number(r.amount)])).toEqual([['WITHDRAWAL', -100], ['EXPENSE', -30]]);
  });

  it('validates lines and permissions, changing nothing on failure', async () => {
    const bill = await submit(true);
    const eggs = await stockOf(db, shop.egg);
    await expect(db.as(cashier, `select public.approve_bill($1, null, null, '[{"description":"x","amount":1}]'::jsonb, 'x')`, [bill.id]))
      .rejects.toThrow(/permission denied/);
    await expect(db.as(manager, `select public.approve_bill($1, null, null, $2::jsonb, 'x')`, [bill.id, JSON.stringify([
      { description: 'ไข่', amount: 50, ingredient_id: shop.egg, quantity: 10 },
      { description: 'ผิด', amount: 1.234 },
    ])])).rejects.toThrow(/VALIDATION/);
    expect(await stockOf(db, shop.egg)).toBe(eggs);
    await expect(db.as(manager, `select public.approve_bill($1, null, null, $2::jsonb, 'x')`, [bill.id, JSON.stringify([
      { description: 'ทาร์ต', amount: 50, ingredient_id: shop.tartItem, quantity: 10 },
    ])])).rejects.toThrow(/only raw ingredients/);
    await expect(db.as(manager, `select public.approve_bill($1, null, null, '[{"description":"x","amount":5}]'::jsonb, '  ')`, [bill.id]))
      .rejects.toThrow(/category is required/);
    expect((await db.adminOne<Bill>(`select * from public.bill_submissions where id = $1`, [bill.id])).status).toBe('PENDING');
  });

  it('rejects with a reason and records Drive links for managers only', async () => {
    const bill = await submit(true);
    await expect(db.as(manager, `select public.reject_bill($1, ' ')`, [bill.id])).rejects.toThrow(/reason is required/);
    const r = await db.asOne<Bill & { review_note: string }>(manager, `select * from public.reject_bill($1, 'ซ้ำ')`, [bill.id]);
    expect(r.status).toBe('REJECTED');
    await db.as(manager, `select public.set_bill_links($1, 'https://drive/a', null)`, [bill.id]);
    expect((await db.adminOne<{ photo_url: string }>(`select photo_url from public.bill_submissions where id = $1`, [bill.id])).photo_url).toBe('https://drive/a');
    await expect(db.as(cashier, `select public.set_bill_links($1, 'x', 'y')`, [bill.id])).rejects.toThrow(/permission denied/);
  });

  it('lets staff unlink themselves and the owner unlink anyone', async () => {
    await expect(db.as(manager, `select public.unlink_telegram($1)`, [cashierEmployee])).rejects.toThrow(/permission denied/);
    await db.as(owner, `select public.unlink_telegram($1)`, [cashierEmployee]);
    expect(await db.admin(`select * from public.telegram_employee(42)`)).toEqual([]);
  });
});

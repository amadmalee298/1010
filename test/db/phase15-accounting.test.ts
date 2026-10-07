import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { openSession, seedShop } from './fixtures';

type Json = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);

describe.skipIf(!hasDb)('Phase 15: accounting (ledger and statements)', () => {
  let db: TestDb;
  let owner: string, manager: string, cashier: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;
  let today: string;

  const balanceSheet = async () => (await db.asOne<{ r: Json }>(manager, `select public.report_balance_sheet($1) as r`, [today])).r;
  const pnl = async () => (await db.asOne<{ r: Json }>(manager, `select public.report_gl_pnl($1, $1) as r`, [today])).r;
  const cashFlow = async () => (await db.asOne<{ r: Json }>(manager, `select public.report_cash_flow($1, $1) as r`, [today])).r;
  const balanceOf = async (code: string) =>
    n((await db.asOne<{ b: string }>(manager, `select balance as b from public.report_trial_balance($1) where account_code = $2`, [today, code])).b);

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER');
    manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER', 'แคชเชียร์');
    shop = await seedShop(db, manager); // opening stock via positive adjustments → 3100
    today = (await db.adminOne<{ d: string }>(`select public.bkk_date(now())::text as d`)).d;

    // Owner records opening balances: bank 50,000 and an oven 20,000, funded by capital.
    await db.as(owner, `select public.post_journal($1, 'ยอดยกมา', $2::jsonb, true)`, [today, JSON.stringify([
      { account_code: '1010', debit: 50000 }, { account_code: '1500', debit: 20000 }, { account_code: '3000', credit: 70000 },
    ])]);
    // Buys a mixer by transfer (investing) and the owner takes 1,000 out (financing).
    await db.as(owner, `select public.post_journal($1, 'ซื้อเครื่องผสม', $2::jsonb)`, [today, JSON.stringify([
      { account_code: '1500', debit: 5000 }, { account_code: '1010', credit: 5000 },
    ])]);
    await db.as(owner, `select public.post_journal($1, 'ถอนใช้ส่วนตัว', $2::jsonb)`, [today, JSON.stringify([
      { account_code: '3200', debit: 1000 }, { account_code: '1010', credit: 1000 },
    ])]);

    // A trading day.
    await openSession(db, cashier, 1000);
    const order = (payload: object) =>
      db.asOne<{ o: { id: string; items: { id: string }[] } }>(cashier, `select public.create_order($1::jsonb) as o`, [JSON.stringify(payload)]);
    await order({ items: [{ product_id: shop.custard, quantity: 2 }], payments: [{ method: 'CASH', amount: 118, tendered: 200 }] });
    await order({ items: [{ product_id: shop.custard, quantity: 1 }], payments: [{ method: 'QR', amount: 59 }] });
    const r = await order({ items: [{ product_id: shop.water, quantity: 3 }], payments: [{ method: 'CASH', amount: 30 }] });
    await db.as(manager, `select public.refund_order($1, $2::jsonb, 'ขวดแตก', 'CASH', false)`,
      [r.o.id, JSON.stringify([{ order_item_id: r.o.items[0]?.id, quantity: 1 }])]);
    const t = await order({ items: [{ product_id: shop.custard, quantity: 1 }], payments: [{ method: 'TRANSFER', amount: 59 }] });
    await db.as(manager, `select public.refund_order($1, $2::jsonb, 'ลูกค้ายกเลิก', 'TRANSFER', true)`,
      [t.o.id, JSON.stringify([{ order_item_id: t.o.items[0]?.id, quantity: 1 }])]);
    await db.as(manager, `select public.record_expense(null, 'บรรจุภัณฑ์', 'ถุง', 25, 'CASH', true)`);
    await db.as(manager, `select public.record_expense(null, 'ค่าน้ำ/ไฟ', 'ค่าไฟ', 800, 'TRANSFER', false)`);
    const voided = await db.asOne<{ id: string }>(manager, `select id from public.record_expense(null, 'อื่น ๆ', 'ผิด', 50, 'CASH', false)`);
    await db.as(owner, `select public.void_expense($1, 'บันทึกผิด')`, [voided.id]);
    await db.as(manager, `select public.record_waste($1, 5, 'ไข่แตก')`, [shop.egg]);
    // Bill approved: eggs into stock paid by transfer, a bag from the drawer-less cash
    const bill = await db.adminOne<{ id: string }>(
      `select id from public.submit_bill(7, 1, (select id from public.employees where user_id = $1), true, 'bills/a.jpg', null, null, null, null, null, 160)`, [cashier]);
    await db.as(manager, `select public.approve_bill($1, null, 'ตลาด', $2::jsonb, 'บรรจุภัณฑ์', 'TRANSFER', false)`, [bill.id, JSON.stringify([
      { description: 'ไข่ 30 ฟอง', amount: 120, ingredient_id: shop.egg, quantity: 30 }, { description: 'ถุง', amount: 40 },
    ])]);
    await db.as(cashier, `select public.cash_movement('WITHDRAWAL', 500, 'ฝากเซฟ')`);
    await db.as(cashier, `select * from public.close_cash_session(600, 'ขาด')`); // expected 1000+148-10-25-500 = 613 → short 13
  });
  afterAll(() => db?.destroy());

  it('keeps the ledger balanced and the clearing account at zero', async () => {
    const tb = await db.as<{ debit: string; credit: string }>(manager, `select debit, credit from public.report_trial_balance($1)`, [today]);
    const dr = tb.reduce((s, r) => s + n(r.debit), 0);
    const cr = tb.reduce((s, r) => s + n(r.credit), 0);
    expect(dr).toBeCloseTo(cr, 2);
    expect(await balanceOf('1190')).toBeCloseTo(0, 2);
  });

  it('balances the balance sheet: assets = liabilities + equity (incl. earnings)', async () => {
    const bs = await balanceSheet();
    expect(n(bs.difference)).toBeCloseTo(0, 2);
    expect(n(bs.total_assets)).toBeCloseTo(n(bs.total_liabilities) + n(bs.total_equity), 2);
  });

  it('tracks cash accounts exactly', async () => {
    expect(await balanceOf('1000')).toBe(0);                     // drawer emptied at close
    expect(await balanceOf('1001')).toBe(-1000 + 600 + 500);     // float out, counted cash + withdrawal into the safe
    // bank: 50,000 − 5,000 − 1,000 + QR 59 + transfer 59 − refund 59 − electricity 800 − bill 160
    expect(await balanceOf('1010')).toBeCloseTo(50000 - 5000 - 1000 + 59 + 59 - 59 - 800 - 160, 2);
  });

  it('matches the operational P&L for sales, COGS, waste and expenses', async () => {
    const op = (await db.asOne<{ r: Json }>(manager, `select public.report_pnl($1, $1) as r`, [today])).r;
    const gl = await pnl();
    const sales = (gl.lines as { code: string; amount: string }[]);
    const acct = (code: string) => n(sales.find((l) => l.code === code)?.amount);
    expect(acct('4010')).toBeLessThan(0);                       // returns reduce revenue
    expect(n(gl.revenue) - acct('4900')).toBeCloseTo(n(op.net_sales), 2);
    expect(n(gl.cogs)).toBeCloseTo(n(op.cogs), 2);
    expect(acct('5310')).toBeCloseTo(n(op.waste), 2);
    expect(n(gl.operating_expenses)).toBeCloseTo(n(op.expenses_total), 2); // 25 + 800 + 40, void excluded
    expect(acct('5900')).toBe(13);
    expect(gl.expense_categories).toEqual(expect.arrayContaining([expect.objectContaining({ category: 'ค่าน้ำ/ไฟ' })]));
  });

  it('reconciles the cash-flow statement', async () => {
    const cf = await cashFlow();
    const items = cf.items as Record<string, string>;
    expect(n(cf.opening_cash)).toBe(50000);               // opening journal counts as opening cash
    expect(n(items.financing)).toBe(-1000);
    expect(n(items.investing)).toBe(-5000);
    expect(n(cf.opening_cash) + n(cf.operating) + n(cf.investing) + n(cf.financing)).toBeCloseTo(n(cf.closing_cash), 2);
  });

  it('validates and protects journals', async () => {
    await expect(db.as(owner, `select public.post_journal($1, 'x', $2::jsonb)`, [today, JSON.stringify([
      { account_code: '6000', debit: 10 }, { account_code: '1010', credit: 9 }])])).rejects.toThrow(/must equal/);
    await expect(db.as(owner, `select public.post_journal($1, 'x', $2::jsonb)`, [today, JSON.stringify([
      { account_code: '1190', debit: 10 }, { account_code: '1010', credit: 10 }])])).rejects.toThrow(/managed by the system/);
    await expect(db.as(manager, `select public.post_journal($1, 'x', $2::jsonb)`, [today, JSON.stringify([
      { account_code: '6000', debit: 10 }, { account_code: '1010', credit: 10 }])])).rejects.toThrow(/permission denied/);
    await expect(db.as(cashier, `select public.report_balance_sheet($1)`, [today])).rejects.toThrow(/permission denied/);
    const je = await db.asOne<{ id: string }>(owner, `select id from public.post_journal($1, 'ค่าเสื่อม', $2::jsonb)`, [today, JSON.stringify([
      { account_code: '6100', debit: 300 }, { account_code: '1510', credit: 300 }])]);
    await db.as(owner, `select public.reverse_journal($1)`, [je.id]);
    await expect(db.as(owner, `select public.reverse_journal($1)`, [je.id])).rejects.toThrow(/already reversed/);
    expect(await balanceOf('6100')).toBe(0);
    await expect(db.admin(`update public.journal_lines set debit = 1`)).rejects.toThrow(/append-only/);
    expect(await db.as(cashier, `select * from public.gl_lines limit 1`).catch((e: Error) => e.message)).toMatch(/permission denied/);
  });

  it('stamps payer and approver signatures on approved bills', async () => {
    const sig = 'data:image/png;base64,iVBORw0KGgo=';
    await db.as(cashier, `select public.save_my_signature($1)`, [sig]);
    await db.as(manager, `select public.save_my_signature($1)`, [sig]);
    await expect(db.as(cashier, `select public.save_my_signature('javascript:alert(1)')`)).rejects.toThrow(/check constraint/);
    const bill = await db.adminOne<{ id: string }>(
      `select id from public.submit_bill(8, 1, (select id from public.employees where user_id = $1), false, null, 'ค่าแก๊ส 380', null, null, null, null, 380)`, [cashier]);
    const done = await db.asOne<{ payer_signature: string; approver_signature: string; approver_name: string; paid_method: string }>(
      manager, `select * from public.approve_bill($1, null, null, '[{"description":"ค่าแก๊ส","amount":380}]'::jsonb, 'อื่น ๆ', 'CASH', false)`, [bill.id]);
    expect(done.payer_signature).toBe(sig);
    expect(done.approver_signature).toBe(sig);
    expect(done.approver_name).toBe('MANAGER');
    expect(done.paid_method).toBe('CASH');
    // cash paid outside the drawer comes out of 1001
    expect(await balanceOf('1001')).toBe(-1000 + 600 + 500 - 380);
    // other staff cannot read someone else's signature
    const other = await db.createEmployee('CASHIER');
    expect(await db.as(other, `select * from public.employee_signatures`)).toEqual([]);
  });
});

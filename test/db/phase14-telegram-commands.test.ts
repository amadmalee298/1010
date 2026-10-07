import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { seedShop } from './fixtures';

describe.skipIf(!hasDb)('Phase 14: Telegram commands', () => {
  let db: TestDb;
  let manager: string, cashier: string;
  let cashierEmployee: string;

  const link = async (userId: string, telegramId: number) => {
    const { code } = await db.asOne<{ code: string }>(userId, `select public.create_telegram_link_code() as code`);
    await db.admin(`select public.telegram_link_account($1, $2, $2, null)`, [code, telegramId]);
  };

  beforeAll(async () => {
    db = await createTestDb();
    manager = await db.createEmployee('MANAGER', 'ผจก');
    cashier = await db.createEmployee('CASHIER', 'แคชเชียร์');
    cashierEmployee = (await db.adminOne<{ id: string }>(`select id from public.employees where user_id = $1`, [cashier])).id;
    await seedShop(db, manager);
    await link(manager, 1);
    await link(cashier, 2);
    await db.admin(`select public.submit_bill(900, 2, $1, false, null, 'ค่าแก๊ส 380', null, null, null, null, 380)`, [cashierEmployee]);
    await db.as(manager, `select public.record_expense(public.bkk_date(now()), 'ค่าน้ำ/ไฟ', 'ค่าไฟ', 500)`);
  });
  afterAll(() => db?.destroy());

  it('reports the linked role', async () => {
    expect(await db.admin(`select display_name, role from public.telegram_staff(1)`)).toEqual([{ display_name: 'ผจก', role: 'MANAGER' }]);
    expect(await db.admin(`select * from public.telegram_staff(999)`)).toEqual([]);
  });

  it('summarises P&L for managers with the same numbers as report_pnl', async () => {
    const s = await db.adminOne<{ s: Record<string, unknown> }>(
      `select public.telegram_summary(1, public.bkk_date(now()), public.bkk_date(now())) as s`);
    expect(Number(s.s.expenses_total)).toBe(500);
    expect(Number(s.s.pending_bills)).toBe(1);
    expect(Number(s.s.purchases)).toBe(0); // opening stock in seedShop is an ADJUSTMENT, not a purchase
    // the impersonation does not leak past the call
    expect((await db.adminOne<{ u: string | null }>(`select auth.uid() as u`)).u).toBeNull();
  });

  it('refuses summaries for cashiers and unlinked users', async () => {
    await expect(db.admin(`select public.telegram_summary(2, public.bkk_date(now()), public.bkk_date(now()))`)).rejects.toThrow(/permission denied/);
    await expect(db.admin(`select public.telegram_summary(999, public.bkk_date(now()), public.bkk_date(now()))`)).rejects.toThrow(/NOT_FOUND/);
  });

  it('lists latest bills: all for managers, own for staff', async () => {
    const other = await db.createEmployee('CASHIER', 'อีกคน');
    await link(other, 3);
    expect((await db.admin(`select * from public.telegram_latest_bills(1, 5)`)).length).toBe(1);
    expect((await db.admin(`select * from public.telegram_latest_bills(2, 5)`)).length).toBe(1);
    expect(await db.admin(`select * from public.telegram_latest_bills(3, 5)`)).toEqual([]);
  });

  it('is callable by service_role only', async () => {
    for (const fn of ['telegram_staff(bigint)', 'telegram_summary(bigint,date,date)', 'telegram_latest_bills(bigint,integer)']) {
      const r = await db.adminOne<{ a: boolean; s: boolean }>(
        `select has_function_privilege('authenticated', 'public.${fn}', 'execute') as a, has_function_privilege('service_role', 'public.${fn}', 'execute') as s`);
      expect(r).toEqual({ a: false, s: true });
    }
  });
});

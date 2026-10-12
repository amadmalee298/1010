import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';

const n = (v: unknown) => Number(v ?? 0);

describe.skipIf(!hasDb)('Phase 19: income from Telegram', () => {
  let db: TestDb;
  let owner: string, cashier: string;

  const balance = async (code: string, asOf: string) =>
    n((await db.adminOne<{ b: string }>(`select coalesce(sum(debit - credit), 0) as b from public.gl_lines where account_code = $1 and entry_date <= $2`, [code, asOf])).b);

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER');
    cashier = await db.createEmployee('CASHIER');
    for (const [user, tg] of [[owner, 301], [cashier, 302]] as const) {
      const { code } = await db.asOne<{ code: string }>(user, `select public.create_telegram_link_code() as code`);
      await db.admin(`select public.telegram_link_account($1, $2, $2, null)`, [code, tg]);
    }
  });
  afterAll(() => db?.destroy());

  it('records income on the typed date to bank or cash, and can undo it', async () => {
    const { id } = await db.adminOne<{ id: string }>(`select public.telegram_income_draft(301, '2026-10-12', 2319, 'รายได้ร้าน') as id`);
    const posted = (await db.adminOne<{ j: { entry_number: string; entry_date: string; amount: number } }>(
      `select public.telegram_post_income(301, $1, '1010') as j`, [id])).j;
    expect(posted.entry_date).toBe('2026-10-12');
    expect(n(posted.amount)).toBe(2319);
    expect(await balance('1010', '2026-10-12')).toBeCloseTo(2319, 2);
    expect(await balance('4000', '2026-10-12')).toBeCloseTo(-2319, 2);
    await expect(db.admin(`select public.telegram_post_income(301, $1, '1001')`, [id])).rejects.toThrow(/INVALID_STATE/);
    await expect(db.admin(`select public.telegram_discard_income(301, $1)`, [id])).rejects.toThrow(/INVALID_STATE/);

    await db.admin(`select public.telegram_reverse_income(301, $1)`, [id]);
    const today = (await db.adminOne<{ d: string }>(`select public.bkk_date(now())::text as d`)).d;
    const end = today > '2026-10-12' ? today : '2026-10-12';
    expect(await balance('1010', end)).toBeCloseTo(0, 2);
    await expect(db.admin(`select public.telegram_reverse_income(301, $1)`, [id])).rejects.toThrow(/INVALID_STATE/);
  });

  it('discards a draft and keeps staff out', async () => {
    const { id } = await db.adminOne<{ id: string }>(`select public.telegram_income_draft(301, null, 100, 'x') as id`);
    await db.admin(`select public.telegram_discard_income(301, $1)`, [id]);
    await expect(db.admin(`select public.telegram_post_income(301, $1, '1001')`, [id])).rejects.toThrow(/NOT_FOUND/);
    await expect(db.admin(`select public.telegram_income_draft(302, null, 100, 'x')`)).rejects.toThrow(/FORBIDDEN/);
    await expect(db.admin(`select public.telegram_income_draft(301, null, 0, 'x')`)).rejects.toThrow(/VALIDATION/);
    await expect(db.as(owner, `select public.telegram_income_draft(301, null, 100, 'x')`)).rejects.toThrow(/permission denied/);
  });
});

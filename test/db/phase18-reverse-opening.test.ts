import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';

type CashFlow = { opening_cash: string | number; operating: string | number; closing_cash: string | number };
const n = (v: unknown) => Number(v ?? 0);

describe.skipIf(!hasDb)('Phase 18: reversing an opening journal', () => {
  let db: TestDb;
  let owner: string;
  let today: string;

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER');
    today = (await db.adminOne<{ d: string }>(`select public.bkk_date(now())::text as d`)).d;
  });
  afterAll(() => db?.destroy());

  it('keeps the reversal in opening cash so the cash flow nets to zero', async () => {
    const lines = JSON.stringify([{ account_code: '1001', debit: 1000, credit: 0 }, { account_code: '5900', debit: 0, credit: 1000 }]);
    const j = await db.asOne<{ id: string; is_opening: boolean }>(owner,
      `select * from public.post_journal($1, 'แก้ยอดนับเงิน', $2::jsonb, true)`, [today, lines]);
    expect(j.is_opening).toBe(true);
    const r = await db.asOne<{ is_opening: boolean }>(owner, `select * from public.reverse_journal($1)`, [j.id]);
    expect(r.is_opening).toBe(true);
    const cf = (await db.asOne<{ c: CashFlow }>(owner, `select public.report_cash_flow($1, $1) as c`, [today])).c;
    expect(n(cf.opening_cash)).toBeCloseTo(0, 2);
    expect(n(cf.operating)).toBeCloseTo(0, 2);
    expect(n(cf.closing_cash)).toBeCloseTo(0, 2);
  });
});

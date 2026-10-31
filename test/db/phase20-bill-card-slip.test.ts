import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';

describe.skipIf(!hasDb)('Phase 20: bill card knows slips', () => {
  let db: TestDb;
  let employee: string;

  beforeAll(async () => {
    db = await createTestDb();
    const user = await db.createEmployee('CASHIER');
    employee = (await db.adminOne<{ id: string }>(`select id from public.employees where user_id = $1`, [user])).id;
  });
  afterAll(() => db?.destroy());

  it('marks a slip-only bill as a slip with a photo, without a receipt', async () => {
    const b = await db.adminOne<{ id: string }>(
      `select id from public.submit_bill(9001, 1, $1, false, 'bills/2026-10/9001.jpeg', null, $2::jsonb, null, 'ร้านป้าแดง', '2026-10-31', 350)`,
      [employee, JSON.stringify({ is_bill: true, is_slip: true, lines: [{ description: 'โอนเงินให้ ร้านป้าแดง', amount: 350 }] })]);
    const c = (await db.adminOne<{ c: { has_photo: boolean; is_slip: boolean; has_receipt: boolean } }>(`select public.bill_card($1) as c`, [b.id])).c;
    expect(c).toMatchObject({ has_photo: true, is_slip: true, has_receipt: false });
  });

  it('treats older extractions without is_slip as not a slip', async () => {
    const b = await db.adminOne<{ id: string }>(
      `select id from public.submit_bill(9002, 1, $1, true, 'bills/2026-10/9002.jpeg', null, '{"is_bill":true,"lines":[]}'::jsonb, null, null, null, null)`, [employee]);
    const c = (await db.adminOne<{ c: { is_slip: boolean } }>(`select public.bill_card($1) as c`, [b.id])).c;
    expect(c.is_slip).toBe(false);
  });
});

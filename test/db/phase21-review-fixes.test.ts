import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { openSession, seedShop } from './fixtures';

interface OrderDoc { id: string; status: string; total: number | string; refunded_total: number | string; business_date?: string; items: { id: string }[] }
const n = (v: unknown) => Number(v ?? 0);

describe.skipIf(!hasDb)('Phase 21: review fixes', () => {
  let db: TestDb;
  let owner: string, manager: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;
  let today: string;

  const order = async (payload: object) =>
    (await db.asOne<{ o: OrderDoc }>(manager, `select public.create_order($1::jsonb) as o`, [JSON.stringify(payload)])).o;
  const dateOf = async (id: string) => (await db.adminOne<{ d: string }>(`select business_date::text as d from public.orders where id = $1`, [id])).d;
  const sale = (extra: object = {}) => ({ client_ref: randomUUID(), items: [{ product_id: shop.custard, quantity: 1 }], payments: [{ method: 'CASH', amount: 59 }], ...extra });

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER');
    manager = await db.createEmployee('MANAGER');
    shop = await seedShop(db, manager);
    await openSession(db, manager);
    today = (await db.adminOne<{ d: string }>(`select public.bkk_date(now())::text as d`)).d;
  });
  afterAll(() => db?.destroy());

  it('books an offline order on the day it was sold, within 3 days and never in the future', async () => {
    const yesterday = (await db.adminOne<{ d: string }>(`select (public.bkk_date(now()) - 1)::text as d`)).d;
    const sold = await order(sale({ sold_at: new Date(Date.now() - 86_400_000).toISOString() }));
    expect(await dateOf(sold.id)).toBe(yesterday);
    expect(await dateOf((await order(sale())).id)).toBe(today);
    expect(await dateOf((await order(sale({ sold_at: new Date(Date.now() + 5 * 86_400_000).toISOString() }))).id)).toBe(today);
    const old = await dateOf((await order(sale({ sold_at: '2020-01-01T00:00:00Z' }))).id);
    expect(old >= (await db.adminOne<{ d: string }>(`select (public.bkk_date(now()) - 3)::text as d`)).d).toBe(true);
  });

  it('refunding the last items one by one ends exactly REFUNDED', async () => {
    const o = await order({ client_ref: randomUUID(), items: [{ product_id: shop.custard, quantity: 3 }], manual_discount: 2,
      payments: [{ method: 'TRANSFER', amount: 175 }] });
    expect(n(o.total)).toBe(175);
    let last: OrderDoc = o;
    for (let i = 0; i < 3; i++) {
      last = (await db.asOne<{ o: OrderDoc }>(manager, `select public.refund_order($1, $2::jsonb, 'คืน', 'TRANSFER', false) as o`,
        [o.id, JSON.stringify([{ order_item_id: o.items[0]?.id, quantity: 1 }])])).o;
    }
    expect(last.status).toBe('REFUNDED');
    expect(n(last.refunded_total)).toBe(175);
  });

  it('never adds cash to a closed drawer session', async () => {
    const s = await db.adminOne<{ id: string }>(`select id from public.cash_sessions where status = 'OPEN'`);
    await db.as(manager, `select public.close_cash_session(1000)`);
    await expect(db.admin(
      `insert into public.cash_transactions (cash_session_id, transaction_type, amount, reference_type, note) values ($1, 'DEPOSIT', 10, 'manual', 'x')`,
      [s.id])).rejects.toThrow(/NO_OPEN_SESSION/);
    await openSession(db, manager);
  });

  it('reverses a journal entry only once', async () => {
    const lines = JSON.stringify([{ account_code: '1001', debit: 100, credit: 0 }, { account_code: '3000', debit: 0, credit: 100 }]);
    const j = await db.asOne<{ id: string }>(owner, `select id from public.post_journal($1, 'ทุน', $2::jsonb)`, [today, lines]);
    await db.as(owner, `select public.reverse_journal($1)`, [j.id]);
    await expect(db.as(owner, `select public.reverse_journal($1)`, [j.id])).rejects.toThrow(/already reversed|duplicate|unique/);
    await expect(db.admin(
      `insert into public.journal_entries (entry_number, entry_date, memo, reverses) values ('JV-X', $1, 'x', $2)`, [today, j.id]))
      .rejects.toThrow(/duplicate|unique/);
  });
});

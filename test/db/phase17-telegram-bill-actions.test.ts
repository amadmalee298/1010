import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { seedShop } from './fixtures';

type Card = {
  submission_number: string; status: string; voided: boolean; total: string | number | null; descriptions: string[];
  payer_name: string; payer_signed: boolean; approver_signed: boolean; category: string | null; substitute_number: string | null;
  attachments: Record<string, number>; company: string; submitter_chat_id: number | null; review_note: string | null;
};
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe.skipIf(!hasDb)('Phase 17: bill actions from Telegram', () => {
  let db: TestDb;
  let owner: string, cashier: string, other: string;
  let cashierEmployee: string;
  let update = 500;

  const submit = async (text = 'นมเมจิ 200') => {
    const b = await db.adminOne<{ id: string; submission_number: string }>(
      `select id, submission_number from public.submit_bill($1, 91, $2, false, null, $3, $4::jsonb, null, null, null, 200)`,
      [update++, cashierEmployee, text, JSON.stringify({ is_bill: false, lines: [{ description: 'นมเมจิ 2000ml', amount: 200 }] })]);
    return b;
  };
  const card = async (tg: number, num: string) =>
    (await db.adminOne<{ c: Card }>(`select public.telegram_bill_card($1, $2) as c`, [tg, num])).c;

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createEmployee('OWNER', 'kameenee.sa');
    cashier = await db.createEmployee('CASHIER', 'aa');
    other = await db.createEmployee('CASHIER', 'bb');
    cashierEmployee = (await db.adminOne<{ id: string }>(`select id from public.employees where user_id = $1`, [cashier])).id;
    await db.as(owner, `update public.employees set legal_name = 'อาห์มัด มะหลี' where user_id = $1`, [cashier]);
    await db.admin(`update public.settings set value = '"บริษัท กะเพรา เอ็นเตอร์ไพรส์ จำกัด (สำนักงานใหญ่)"'::jsonb where key = 'company_name'`);
    await seedShop(db, owner);
    for (const [user, tg] of [[cashier, 91], [other, 92], [owner, 93]] as const) {
      const { code } = await db.asOne<{ code: string }>(user, `select public.create_telegram_link_code() as code`);
      await db.admin(`select public.telegram_link_account($1, $2, $2, null)`, [code, tg]);
    }
  });
  afterAll(() => db?.destroy());

  it('builds the card for a pending no-receipt bill', async () => {
    const b = await submit();
    await db.as(cashier, `select public.save_my_signature($1)`, [PNG]);
    const c = await card(91, b.submission_number);
    expect(c.status).toBe('PENDING');
    expect(Number(c.total)).toBe(200);
    expect(c.descriptions).toEqual(['นมเมจิ 2000ml']);
    expect(c.payer_name).toBe('อาห์มัด มะหลี');
    expect(c.payer_signed).toBe(true);
    expect(c.approver_signed).toBe(false);
    expect(c.company).toBe('บริษัท กะเพรา เอ็นเตอร์ไพรส์ จำกัด (สำนักงานใหญ่)');
    expect(Number(c.submitter_chat_id)).toBe(91);
    // only the submitter or a manager may see it
    await expect(card(92, b.submission_number)).rejects.toThrow(/NOT_FOUND/);
    expect((await card(93, b.submission_number)).submission_number).toBe(b.submission_number);
  });

  it('attaches the next photo after an attach button, with its kind, once', async () => {
    const b = await submit();
    await db.admin(`select public.telegram_await_upload(91, $1, 'SLIP')`, [b.submission_number]);
    const taken = await db.admin(`select * from public.telegram_take_upload(91)`);
    expect(taken).toEqual([{ submission_number: b.submission_number, kind: 'SLIP' }]);
    expect(await db.admin(`select * from public.telegram_take_upload(91)`)).toEqual([]);
    await db.admin(`select public.telegram_add_attachment(91, $1, 'bills/2026-10/slip.jpg', 'SLIP')`, [b.submission_number]);
    await db.admin(`select public.telegram_add_attachment(91, $1, 'bills/2026-10/goods.jpg')`, [b.submission_number]);
    expect((await card(91, b.submission_number)).attachments).toEqual({ SLIP: 1, EVIDENCE: 1, OTHER: 0 });
    // expired waits are ignored
    await db.admin(`select public.telegram_await_upload(91, $1, 'EVIDENCE')`, [b.submission_number]);
    await db.admin(`update public.telegram_pending_uploads set expires_at = now() - interval '1 minute'`);
    expect(await db.admin(`select * from public.telegram_take_upload(91)`)).toEqual([]);
    await expect(db.admin(`select public.telegram_await_upload(92, $1, 'SLIP')`, [b.submission_number])).rejects.toThrow(/NOT_FOUND/);
  });

  it('lets the submitter cancel a pending bill, but not an approved one', async () => {
    const b = await submit();
    await expect(db.admin(`select public.telegram_cancel_bill(92, $1)`, [b.submission_number])).rejects.toThrow(/NOT_FOUND/);
    await db.admin(`select public.telegram_cancel_bill(91, $1)`, [b.submission_number]);
    const c = await card(91, b.submission_number);
    expect(c.status).toBe('REJECTED');
    expect(c.review_note).toBe('ผู้ส่งยกเลิกทาง Telegram');
    await expect(db.admin(`select public.telegram_cancel_bill(91, $1)`, [b.submission_number])).rejects.toThrow(/INVALID_STATE/);
    await expect(db.admin(`select public.telegram_await_upload(91, $1, 'SLIP')`, [b.submission_number])).rejects.toThrow(/INVALID_STATE/);
    await expect(db.as(owner, `select public.approve_bill($1, null, null, '[{"description":"a","amount":1}]'::jsonb, 'อื่น ๆ', 'CASH', false)`, [b.id]))
      .rejects.toThrow(/INVALID_STATE/);

    const a = await submit();
    await db.as(owner, `select public.save_my_signature($1)`, [PNG]);
    await db.as(owner, `select public.approve_bill($1, null, null, '[{"description":"นมเมจิ 2000ml","amount":200}]'::jsonb, 'วัตถุดิบ', 'TRANSFER', false)`, [a.id]);
    await expect(db.admin(`select public.telegram_cancel_bill(91, $1)`, [a.submission_number])).rejects.toThrow(/INVALID_STATE/);
    const done = await card(91, a.submission_number);
    expect(done.status).toBe('APPROVED');
    expect(done.category).toBe('วัตถุดิบ');
    expect(done.substitute_number).toMatch(/^\d{4}\/\d{2}-\d{3}$/);
    expect(done.payer_signed && done.approver_signed).toBe(true);
  });

  it('keeps the webhook functions away from app users', async () => {
    await expect(db.as(cashier, `select public.telegram_cancel_bill(91, 'BL000000-0000')`)).rejects.toThrow(/permission denied/);
    await expect(db.as(owner, `select public.bill_card(gen_random_uuid())`)).rejects.toThrow(/permission denied/);
    await expect(db.as(cashier, `select * from public.telegram_pending_uploads`)).rejects.toThrow(/permission denied/);
  });
});

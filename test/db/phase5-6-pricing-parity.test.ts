import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, hasDb, type TestDb } from './harness';
import { seedShop } from './fixtures';
import { priceOrder, type PricingSettings, type PromotionRule } from '@/domain/pricing';

/** The POS preview (TypeScript) must produce exactly what the database charges. */
describe.skipIf(!hasDb)('pricing parity: domain/pricing.ts vs public.price_order', () => {
  let db: TestDb;
  let cashier: string;
  let shop: Awaited<ReturnType<typeof seedShop>>;
  const prices: Record<string, number> = {};

  beforeAll(async () => {
    db = await createTestDb();
    const manager = await db.createEmployee('MANAGER');
    cashier = await db.createEmployee('CASHIER');
    shop = await seedShop(db, manager);
    for (const r of await db.admin<{ id: string; price: string }>('select id, price from public.products')) prices[r.id] = Number(r.price);
    await db.admin(`update public.customers set points_balance = 500 where id = $1`, [shop.customer]);
  });
  afterAll(() => db?.destroy());

  // deterministic pseudo-random generator
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

  for (const vat of [{ vatEnabled: false, vatInclusive: true }, { vatEnabled: true, vatInclusive: true }, { vatEnabled: true, vatInclusive: false }]) {
    it(`matches for 25 random carts (vat=${vat.vatEnabled}, inclusive=${vat.vatInclusive})`, async () => {
      await db.admin(`update public.settings set value = $1::jsonb where key = 'vat_enabled'`, [JSON.stringify(vat.vatEnabled)]);
      await db.admin(`update public.settings set value = $1::jsonb where key = 'vat_inclusive'`, [JSON.stringify(vat.vatInclusive)]);
      const settings: PricingSettings = { ...vat, vatRate: 7, bahtPerPoint: 25, pointValue: 1, minRedeemPoints: 10 };
      const promo10: PromotionRule = { id: shop.promo10, name: 'ลด 10%', discountType: 'PERCENT', value: 10, minSubtotal: 0, maxDiscount: 50, membersOnly: false, startsAt: null, endsAt: null, isActive: true };

      for (let n = 0; n < 25; n++) {
        const products = [shop.custard, shop.box, shop.water, shop.tart];
        const lines = products.filter(() => rnd() > 0.4).map((id) => ({ productId: id, unitPrice: prices[id] ?? 0, quantity: 1 + Math.floor(rnd() * 7) }));
        if (!lines.length) lines.push({ productId: shop.custard, unitPrice: prices[shop.custard] ?? 0, quantity: 3 });
        const usePromo = rnd() > 0.5;
        const withCustomer = rnd() > 0.5;
        const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
        const manual = rnd() > 0.6 ? Math.floor(rnd() * subtotal * 0.3 * 100) / 100 : 0;
        const redeem = withCustomer && rnd() > 0.5 ? 10 + Math.floor(rnd() * 20) : 0;

        const ts = priceOrder({
          lines, promotion: usePromo ? promo10 : null, customer: withCustomer ? { pointsBalance: 500 } : null,
          manualDiscount: manual, redeemPoints: redeem,
        }, settings);
        const sql = (await db.asOne<{ q: Record<string, number> }>(cashier, 'select public.quote_order($1::jsonb) as q', [JSON.stringify({
          items: lines.map((l) => ({ product_id: l.productId, quantity: l.quantity })),
          promotion_id: usePromo ? shop.promo10 : null, customer_id: withCustomer ? shop.customer : null,
          manual_discount: manual, redeem_points: redeem,
        })])).q;
        expect({
          subtotal: Number(sql.subtotal), promotionDiscount: Number(sql.promotion_discount), manualDiscount: Number(sql.manual_discount),
          pointsRedeemed: Number(sql.points_redeemed), pointsDiscount: Number(sql.points_discount), vatAmount: Number(sql.vat_amount),
          total: Number(sql.total), pointsEarned: Number(sql.points_earned),
        }).toEqual(ts);
      }
    });
  }
});

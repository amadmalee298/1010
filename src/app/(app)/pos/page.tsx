import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listCategories, listProducts, productImageUrl } from '@/server/repositories/catalog';
import { getSettings } from '@/server/repositories/settings';
import { listActivePromotions } from '@/server/repositories/promotions';
import { unwrap } from '@/server/db';
import { PosScreen } from '@/components/pos/pos-screen';
import type { PosConfig, PosMenu } from '@/components/pos/types';
import { FRONT_OF_HOUSE } from '@/domain/permissions';

export const metadata: Metadata = { title: 'POS' };

export default async function PosPage() {
  const employee = await requireEmployee(FRONT_OF_HOUSE);
  const db = await createSupabaseServerClient();
  const [categories, products, availability, promotions, settings, session] = await Promise.all([
    listCategories(db, { activeOnly: true }),
    listProducts(db, { activeOnly: true }),
    db.from('product_availability').select('*').then(unwrap),
    listActivePromotions(db),
    getSettings(db),
    db.rpc('current_cash_session_id').then((r) => r.data),
  ]);
  const available = new Map(availability.map((a) => [a.product_id, a.available]));
  const activeCats = new Set(categories.map((c) => c.id));

  const menu: PosMenu = {
    categories: categories.map((c) => ({ id: c.id, name: c.name_th })),
    products: products
      .filter((p) => !p.category_id || activeCats.has(p.category_id))
      .map((p) => ({
        id: p.id, name: p.name_th, sku: p.sku, price: p.price, categoryId: p.category_id,
        imageUrl: productImageUrl(db, p.image_path), available: available.get(p.id) ?? null,
      })),
    promotions,
    fetchedAt: new Date().toISOString(),
  };
  const config: PosConfig = {
    pricing: {
      vatEnabled: settings.vat_enabled, vatInclusive: settings.vat_inclusive, vatRate: settings.vat_rate,
      bahtPerPoint: settings.baht_per_point, pointValue: settings.point_value, minRedeemPoints: settings.min_redeem_points,
    },
    receipt: {
      shopName: settings.shop_name, shopAddress: settings.shop_address, shopPhone: settings.shop_phone, taxId: settings.tax_id,
      vatEnabled: settings.vat_enabled, vatRate: settings.vat_rate, receiptFooter: settings.receipt_footer,
    },
    promptpayId: settings.promptpay_id,
    maxCashierDiscount: settings.max_cashier_discount,
    isCashier: employee.role === 'CASHIER',
  };
  return <PosScreen menu={menu} config={config} sessionOpen={!!session} />;
}

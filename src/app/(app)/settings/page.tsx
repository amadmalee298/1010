import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { getSettings } from '@/server/repositories/settings';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { SettingsForm } from '@/components/admin/settings-form';
import { OWNER_ONLY } from '@/domain/permissions';

export default async function SettingsPage() {
  await requireEmployee(OWNER_ONLY);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const s = await getSettings(db);
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.admin.settings} />
      <SettingsForm settings={{
        shop_name: s.shop_name, shop_address: s.shop_address, shop_phone: s.shop_phone, tax_id: s.tax_id, receipt_footer: s.receipt_footer,
        vat_enabled: s.vat_enabled, vat_rate: s.vat_rate, vat_inclusive: s.vat_inclusive, promptpay_id: s.promptpay_id,
        max_cashier_discount: s.max_cashier_discount, baht_per_point: s.baht_per_point, point_value: s.point_value, min_redeem_points: s.min_redeem_points,
      }} />
    </div>
  );
}

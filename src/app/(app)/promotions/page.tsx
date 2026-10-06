import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listPromotions } from '@/server/repositories/promotions';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { PromotionManager } from '@/components/crm/promotion-manager';
import { MANAGEMENT } from '@/domain/permissions';

export default async function PromotionsPage() {
  await requireEmployee(MANAGEMENT);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.promotions.title} />
      <PromotionManager promotions={await listPromotions(db)} />
    </div>
  );
}

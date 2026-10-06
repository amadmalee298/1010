import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listKitchenQueue } from '@/server/repositories/orders';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { KitchenBoard } from '@/components/kitchen/kitchen-board';

export default async function KitchenPage() {
  await requireEmployee();
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const tickets = await listKitchenQueue(db);
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.kitchen.title} />
      <KitchenBoard initial={tickets} />
    </div>
  );
}

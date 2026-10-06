import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listCustomers } from '@/server/repositories/customers';
import { unwrap } from '@/server/db';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { CustomerManager } from '@/components/crm/customer-manager';
import { can, FRONT_OF_HOUSE } from '@/domain/permissions';
import type { CustomerPointsRow } from '@/lib/database.types';

export default async function CustomersPage() {
  const employee = await requireEmployee(FRONT_OF_HOUSE);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const [customers, points] = await Promise.all([
    listCustomers(db),
    db.from('customer_points').select('*').order('created_at', { ascending: false }).limit(2000).then(unwrap),
  ]);
  const history: Record<string, CustomerPointsRow[]> = {};
  for (const p of points) (history[p.customer_id] ??= []).push(p);
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.customers.title} />
      <CustomerManager customers={customers} history={history} canAdjust={can(employee.role, 'managePromotions')} />
    </div>
  );
}

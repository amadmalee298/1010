import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listSuppliers } from '@/server/repositories/operations';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { SupplierManager } from '@/components/operations/supplier-manager';
import { MANAGEMENT } from '@/domain/permissions';

export default async function SuppliersPage() {
  await requireEmployee(MANAGEMENT);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.purchasing.suppliers} />
      <SupplierManager suppliers={await listSuppliers(db)} />
    </div>
  );
}

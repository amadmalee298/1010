import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { unwrap } from '@/server/db';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { EmployeeManager } from '@/components/admin/employee-manager';
import { OWNER_ONLY } from '@/domain/permissions';

export default async function EmployeesPage() {
  await requireEmployee(OWNER_ONLY);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const employees = unwrap(await db.from('employee_directory').select('*').order('is_active', { ascending: false }).order('display_name'));
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.admin.employees} />
      <EmployeeManager employees={employees} canCreate={!!process.env.SUPABASE_SERVICE_ROLE_KEY} />
    </div>
  );
}

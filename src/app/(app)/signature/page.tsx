import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { mySignature } from '@/server/repositories/accounting';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { SignaturePad } from '@/components/accounting/signature-pad';
import { FRONT_OF_HOUSE } from '@/domain/permissions';

export default async function SignaturePage() {
  const employee = await requireEmployee(FRONT_OF_HOUSE);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const current = await mySignature(db, employee.employeeId);
  return (
    <div className="max-w-2xl p-4 lg:p-6">
      <PageHeader title={t.signature.title} description={t.signature.intro} />
      <SignaturePad current={current} />
    </div>
  );
}

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { myTelegramAccount } from '@/server/repositories/bills';
import { telegramConfigured } from '@/server/integrations/telegram';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { TelegramLink } from '@/components/bills/telegram-link';
import { FRONT_OF_HOUSE } from '@/domain/permissions';

export default async function TelegramPage() {
  const employee = await requireEmployee(FRONT_OF_HOUSE);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const account = await myTelegramAccount(db, employee.employeeId);
  return (
    <div className="max-w-xl p-4 lg:p-6">
      <PageHeader title={t.telegram.title} description={t.telegram.intro} />
      {telegramConfigured()
        ? <TelegramLink employeeId={employee.employeeId} linkedAs={account ? (account.username ? `@${account.username}` : String(account.telegram_user_id)) : null} />
        : <p className="rounded-xl bg-warning/15 p-4">{t.telegram.notConfigured}</p>}
      <p className="mt-6 text-sm text-muted-foreground">{t.telegram.howTo}</p>
    </div>
  );
}

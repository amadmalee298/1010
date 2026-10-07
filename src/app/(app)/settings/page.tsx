import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { getSettings } from '@/server/repositories/settings';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { SettingsForm } from '@/components/admin/settings-form';
import { OWNER_ONLY } from '@/domain/permissions';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TelegramWebhookButton } from '@/components/bills/telegram-link';
import { telegramConfigured, tokenLooksValid, webhookSecret } from '@/server/integrations/telegram';
import { billReaderConfigured } from '@/server/integrations/bill-reader';
import { driveConfigured } from '@/server/integrations/google-drive';

export default async function SettingsPage() {
  await requireEmployee(OWNER_ONLY);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const s = await getSettings(db);
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.admin.settings} />
      <SettingsForm settings={{
        shop_name: s.shop_name, company_name: s.company_name, shop_address: s.shop_address, shop_phone: s.shop_phone, tax_id: s.tax_id, receipt_footer: s.receipt_footer,
        vat_enabled: s.vat_enabled, vat_rate: s.vat_rate, vat_inclusive: s.vat_inclusive, promptpay_id: s.promptpay_id,
        max_cashier_discount: s.max_cashier_discount, baht_per_point: s.baht_per_point, point_value: s.point_value, min_redeem_points: s.min_redeem_points,
      }} />
      <Card className="mt-4">
        <CardHeader><CardTitle>{t.admin.integrations}</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          {([
            ['Telegram (TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET)', telegramConfigured() && tokenLooksValid() && webhookSecret().length >= 16],
            ['AI (ANTHROPIC_API_KEY)', billReaderConfigured()],
            ['Google Drive (GOOGLE_DRIVE_SCRIPT_URL, GOOGLE_DRIVE_SCRIPT_SECRET)', driveConfigured()],
          ] as const).map(([name, ok]) => (
            <div key={name} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{name}</span>
              <Badge variant={ok ? 'success' : 'secondary'}>{ok ? t.admin.connected : t.admin.missing}</Badge>
            </div>
          ))}
          {telegramConfigured() ? <div><TelegramWebhookButton /></div> : null}
        </CardContent>
      </Card>
    </div>
  );
}

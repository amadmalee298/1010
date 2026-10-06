'use client';
import { Languages } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { setLocaleAction } from '@/server/actions/admin';

export function LocaleSwitch() {
  const { locale, t } = useI18n();
  const { run, pending } = useAction(setLocaleAction, { successMessage: false });
  return (
    <button type="button" disabled={pending} onClick={() => void run({ locale: locale === 'th' ? 'en' : 'th' })}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-muted" aria-label={t.admin.language}>
      <Languages className="size-5" aria-hidden /> {locale === 'th' ? 'English' : 'ภาษาไทย'}
    </button>
  );
}

'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { ActionResult } from '@/server/action-types';
import { useI18n } from '@/i18n/client';

/**
 * Call a Server Action with pending state, toast feedback and router refresh.
 * Returns the data on success, or null (error already shown).
 */
export function useAction<I, R>(action: (input: I) => Promise<ActionResult<R>>, opts: { successMessage?: string | false; refresh?: boolean } = {}) {
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const router = useRouter();
  const { t } = useI18n();

  const run = (input: I): Promise<R | null> =>
    new Promise((resolve) => {
      startTransition(async () => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          toast.error(t.errors.offline);
          resolve(null);
          return;
        }
        const res = await action(input);
        if (res.ok) {
          setFieldErrors({});
          if (opts.successMessage !== false) toast.success(opts.successMessage ?? t.common.saved);
          if (opts.refresh !== false) router.refresh();
          resolve(res.data);
        } else {
          setFieldErrors(res.fieldErrors ?? {});
          toast.error(res.error);
          resolve(null);
        }
      });
    });

  return { run, pending, fieldErrors };
}

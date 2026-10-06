'use client';
import { useSyncExternalStore } from 'react';
import { WifiOff } from 'lucide-react';
import { useI18n } from '@/i18n/client';

function subscribe(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

export function OnlineStatus() {
  const online = useOnline();
  const { t } = useI18n();
  if (online) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/20 px-3 py-1 text-xs font-medium text-warning-strong">
      <WifiOff className="size-3.5" aria-hidden /> {t.errors.offline}
    </span>
  );
}

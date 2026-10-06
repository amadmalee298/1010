'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createOrderAction } from '@/server/actions/orders';
import { getQueue, markResult, subscribeQueue, type QueuedOrder } from '@/lib/offline/order-queue';
import { useI18n } from '@/i18n/client';

const SYNC_INTERVAL_MS = 30_000;

/** Keeps the offline order queue flushing whenever the device is online. */
export function useOrderSync() {
  const { t } = useI18n();
  const [queue, setQueue] = useState<QueuedOrder[]>([]);
  const running = useRef(false);

  const flush = useCallback(async () => {
    if (running.current || !navigator.onLine) return;
    running.current = true;
    try {
      for (const entry of getQueue().filter((q) => q.status === 'PENDING')) {
        try {
          const res = await createOrderAction(entry.payload);
          if (res.ok) markResult(entry.clientRef, { ok: true });
          else {
            markResult(entry.clientRef, { ok: false, error: res.error, retryable: false });
            toast.error(`${t.pos.syncFailed}: ${res.error}`);
          }
        } catch (err) {
          // network failure: keep pending and stop this round
          markResult(entry.clientRef, { ok: false, error: err instanceof Error ? err.message : 'network', retryable: true });
          break;
        }
      }
    } finally {
      running.current = false;
    }
  }, [t]);

  useEffect(() => {
    setQueue(getQueue());
    const unsub = subscribeQueue(setQueue);
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => void flush(), SYNC_INTERVAL_MS);
    void flush();
    return () => {
      unsub();
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, [flush]);

  return { queue, flush };
}

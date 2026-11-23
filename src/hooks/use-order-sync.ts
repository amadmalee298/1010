'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createOrderAction } from '@/server/actions/orders';
import { getQueue, markResult, subscribeQueue, type QueuedOrder } from '@/lib/offline/order-queue';
import { useI18n } from '@/i18n/client';

const SYNC_INTERVAL_MS = 30_000;
const OFFLINE_MIN_AGE_MS = 65_000;

/** Keeps the offline order queue flushing whenever the device is online. */
export function useOrderSync() {
  const { t } = useI18n();
  const [queue, setQueue] = useState<QueuedOrder[]>([]);
  const running = useRef(false);
  // A flush asked for while one is running (e.g. "send again") runs right after it, not 30 s later.
  const again = useRef(false);

  const flush = useCallback(async () => {
    if (!navigator.onLine) return;
    if (running.current) { again.current = true; return; }
    running.current = true;
    try {
      do {
        again.current = false;
        for (const entry of getQueue().filter((q) => q.status === 'PENDING')) {
          // Queues saved before sold_at existed: their createdAt is when the sale happened.
          const soldAt = entry.payload.sold_at ?? entry.createdAt;
          // The server lets an offline sale take stock below zero only once it is a minute old;
          // a younger one waits for a later round instead of failing on short stock.
          if (Date.now() - Date.parse(soldAt) < OFFLINE_MIN_AGE_MS) continue;
          try {
            const res = await createOrderAction({ ...entry.payload, sold_at: soldAt, offline: true });
            if (res.ok) markResult(entry.clientRef, { ok: true });
            else if (res.retryable) {
              // Signed out, no open drawer or a passing error: keep the order queued and try again later.
              markResult(entry.clientRef, { ok: false, error: res.error, retryable: true });
              toast.error(`${t.pos.syncFailed}: ${res.error}`);
              break;
            } else {
              markResult(entry.clientRef, { ok: false, error: res.error, retryable: false });
              toast.error(`${t.pos.syncFailed}: ${res.error}`);
            }
          } catch (err) {
            // network failure: keep pending and stop this round
            markResult(entry.clientRef, { ok: false, error: err instanceof Error ? err.message : 'network', retryable: true });
            break;
          }
        }
      } while (again.current && navigator.onLine);
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

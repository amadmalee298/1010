'use client';
import { RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/i18n/client';
import { formatAmount } from '@/domain/money';
import { formatDateTime } from '@/domain/datetime';
import { discardOrder, retryOrder, type QueuedOrder } from '@/lib/offline/order-queue';

/**
 * Offline sales the server refused. They stay on this device until someone sends them again
 * (after fixing the cause, e.g. opening the drawer) or deletes them on purpose.
 */
export function FailedSyncDialog({ open, onOpenChange, failed, online, onRetry }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  failed: QueuedOrder[];
  online: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const retry = (ref: string) => { retryOrder(ref); onRetry(); };
  const retryAll = () => { for (const q of failed) retryOrder(q.clientRef); onRetry(); };
  const discard = (q: QueuedOrder) => {
    if (window.confirm(t.pos.failedDiscardConfirm.replace('{amount}', formatAmount(q.total)))) discardOrder(q.clientRef);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.pos.syncFailed} ({failed.length})</DialogTitle>
          <DialogDescription>{t.pos.failedHint}</DialogDescription>
        </DialogHeader>
        <ul className="grid max-h-[60dvh] gap-2 overflow-y-auto">
          {failed.map((q) => (
            <li key={q.clientRef} className="grid gap-1 rounded-xl border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">฿{formatAmount(q.total)}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(q.payload.sold_at ?? q.createdAt)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {q.payload.items.reduce((s, i) => s + i.quantity, 0)} {t.pos.items}
              </p>
              {q.lastError ? <p className="text-xs text-destructive">{q.lastError}</p> : null}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => discard(q)}><Trash2 /> {t.common.delete}</Button>
                <Button size="sm" disabled={!online} onClick={() => retry(q.clientRef)}><RefreshCw /> {t.pos.retrySend}</Button>
              </div>
            </li>
          ))}
        </ul>
        {failed.length > 1 ? (
          <Button disabled={!online} onClick={retryAll}><RefreshCw /> {t.pos.retryAll}</Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

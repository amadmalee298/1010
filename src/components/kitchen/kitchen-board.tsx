'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/client';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { setKitchenStatusAction } from '@/server/actions/orders';
import type { KitchenQueueRow, KitchenStatus } from '@/lib/database.types';
import { formatTime } from '@/domain/datetime';

const NEXT: Partial<Record<KitchenStatus, KitchenStatus>> = { PENDING: 'PREPARING', PREPARING: 'READY', READY: 'SERVED' };
const PREV: Partial<Record<KitchenStatus, KitchenStatus>> = { PREPARING: 'PENDING', READY: 'PREPARING' };
const LATE_MINUTES = 10;
const POLL_MS = 15_000;

export function KitchenBoard({ initial }: { initial: KitchenQueueRow[] }) {
  const { t } = useI18n();
  const [tickets, setTickets] = useState(initial);
  const [sound, setSound] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const known = useRef(new Set(initial.map((x) => x.id)));

  const beep = useCallback(() => {
    if (!sound) return;
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; gain.gain.value = 0.15;
      osc.start(); osc.stop(ctx.currentTime + 0.25);
    } catch { /* audio not available */ }
  }, [sound]);

  const load = useCallback(async () => {
    const { data, error } = await getSupabaseBrowserClient().from('kitchen_queue').select('*').order('created_at');
    if (error || !data) return;
    if (data.some((x) => !known.current.has(x.id))) beep();
    known.current = new Set(data.map((x) => x.id));
    setTickets(data);
  }, [beep]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel('kitchen-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => void load())
      .subscribe();
    const poll = window.setInterval(() => void load(), POLL_MS);   // fallback if realtime is unavailable
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { void supabase.removeChannel(channel); window.clearInterval(poll); window.clearInterval(clock); };
  }, [load]);

  async function move(id: string, status: KitchenStatus) {
    setTickets((ts) => ts.map((x) => (x.id === id ? { ...x, kitchen_status: status } : x)).filter((x) => x.kitchen_status !== 'SERVED'));
    const res = await setKitchenStatusAction({ order_id: id, status });
    if (!res.ok) { toast.error(res.error); void load(); }
  }

  const columns: KitchenStatus[] = ['PENDING', 'PREPARING', 'READY'];
  return (
    <div className="grid gap-3">
      <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" className="size-5" checked={sound} onChange={(e) => setSound(e.target.checked)} /> {t.kitchen.sound}</label>
      <div className="grid gap-4 md:grid-cols-3">
        {columns.map((col) => {
          const list = tickets.filter((x) => x.kitchen_status === col);
          return (
            <section key={col} className="rounded-2xl bg-muted/60 p-3">
              <h2 className="mb-3 flex items-center justify-between font-semibold">{t.kitchen.status[col]} <span className="rounded-full bg-card px-2 text-sm">{list.length}</span></h2>
              <div className="grid gap-3">
                {list.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{t.kitchen.empty}</p> : null}
                {list.map((x) => {
                  const mins = Math.floor((now - new Date(x.created_at).getTime()) / 60_000);
                  const late = col !== 'READY' && mins >= LATE_MINUTES;
                  const next = NEXT[col];
                  const prev = PREV[col];
                  return (
                    <article key={x.id} className={cn('rounded-2xl border-t-4 bg-card p-4 shadow-sm',
                      col === 'PENDING' ? 'border-warning' : col === 'PREPARING' ? 'border-info' : 'border-success', late && 'ring-2 ring-destructive')}>
                      <div className="flex items-start justify-between">
                        <span className="text-3xl font-bold">#{x.queue_number}</span>
                        <span className={cn('rounded-full px-2 py-0.5 text-xs', late ? 'bg-destructive text-destructive-foreground' : 'bg-muted')}>
                          {formatTime(x.created_at)} · {mins} {t.kitchen.minutes}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">{t.pos.orderType[x.order_type]}{x.table_label ? ` · ${x.table_label}` : ''}</p>
                      <ul className="my-3 grid gap-1">
                        {x.items.map((i, k) => (
                          <li key={k}><span className="font-semibold">{i.quantity} × {i.name}</span>{i.note ? <p className="text-sm text-destructive">📝 {i.note}</p> : null}</li>
                        ))}
                      </ul>
                      {x.note ? <p className="mb-2 text-sm text-destructive">📝 {x.note}</p> : null}
                      <div className="flex gap-2">
                        {prev ? <Button variant="outline" onClick={() => void move(x.id, prev)}>{t.kitchen.back}</Button> : null}
                        {next ? <Button className="flex-1" size="lg" onClick={() => void move(x.id, next)}>
                          {col === 'PENDING' ? t.kitchen.start : col === 'PREPARING' ? t.kitchen.done : t.kitchen.serve}
                        </Button> : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

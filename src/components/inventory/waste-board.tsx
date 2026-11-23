'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { formatAmount, formatQty } from '@/domain/money';
import { formatDateTime } from '@/domain/datetime';
import { WasteDialog, type WasteItem } from './waste-dialog';

export interface WasteHistoryRow { id: string; created_at: string; name: string; unit: string; quantity: number; reason: string; total_cost: number }

/** Pick an item (search or tap) to record waste; below, what was thrown away recently. */
export function WasteBoard({ items, history, showCost }: { items: WasteItem[]; history: WasteHistoryRow[]; showCost: boolean }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const [target, setTarget] = useState<WasteItem | null>(null);
  const q = filter.trim().toLowerCase();
  const visible = items.filter((i) => !q || i.name_th.toLowerCase().includes(q));

  return (
    <>
      <Input placeholder={t.waste.search} value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-3" type="search" />
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((i) => (
          <button key={i.id} type="button" onClick={() => setTarget(i)}
            className="grid gap-0.5 rounded-xl border bg-card p-3 text-left hover:bg-muted">
            <span className="font-medium leading-tight">{i.name_th}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{t.waste.left}: {formatQty(i.stock_qty)} {i.unit}</span>
          </button>
        ))}
      </div>

      <h2 className="mb-2 font-semibold">{t.waste.history}</h2>
      {history.length ? (
        <Table>
          <THead><TR><TH>{t.common.date}</TH><TH>{t.common.name}</TH><TH className="text-right">{t.common.quantity}</TH><TH>{t.waste.reason}</TH>{showCost ? <TH className="text-right">{t.waste.value}</TH> : null}</TR></THead>
          <TBody>
            {history.map((h) => (
              <TR key={h.id}>
                <TD className="whitespace-nowrap text-xs">{formatDateTime(h.created_at)}</TD>
                <TD>{h.name}</TD>
                <TD className="text-right tabular-nums">{formatQty(h.quantity)} {h.unit}</TD>
                <TD>{h.reason}</TD>
                {showCost ? <TD className="text-right tabular-nums">{formatAmount(h.total_cost)}</TD> : null}
              </TR>
            ))}
          </TBody>
        </Table>
      ) : <p className="text-sm text-muted-foreground">{t.waste.empty}</p>}

      <WasteDialog item={target} onClose={() => setTarget(null)} />
    </>
  );
}

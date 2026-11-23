import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listStockLevels, listWaste } from '@/server/repositories/inventory';
import { getT } from '@/i18n/server';
import { PageHeader, StatCard } from '@/components/ui/misc';
import { WasteBoard } from '@/components/inventory/waste-board';
import { can, FRONT_OF_HOUSE } from '@/domain/permissions';
import { formatTHB } from '@/domain/money';
import { bangkokDate } from '@/domain/datetime';

export default async function WastePage() {
  const employee = await requireEmployee(FRONT_OF_HOUSE);
  const showCost = can(employee.role, 'adjustInventory');
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const [levels, waste] = await Promise.all([listStockLevels(db), listWaste(db, 200)]);
  const byId = new Map(levels.map((l) => [l.id, l]));
  const month = bangkokDate().slice(0, 7);
  const monthTotal = waste
    .filter((w) => new Date(w.created_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).startsWith(month))
    .reduce((s, w) => s + Number(w.total_cost), 0);
  // Finished goods first: expired custard is the usual case.
  const items = [...levels]
    .sort((a, b) => (a.item_type === b.item_type ? a.name_th.localeCompare(b.name_th, 'th') : a.item_type === 'FINISHED' ? -1 : 1))
    .map((l) => ({ id: l.id, name_th: l.name_th, unit: l.unit, stock_qty: l.stock_qty }));
  const history = waste.map((w) => ({
    id: w.id, created_at: w.created_at, name: byId.get(w.ingredient_id)?.name_th ?? '—', unit: byId.get(w.ingredient_id)?.unit ?? '',
    quantity: Number(w.quantity), reason: w.reason, total_cost: Number(w.total_cost),
  }));

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.waste.title} description={t.waste.description} />
      {showCost ? <div className="mb-5 max-w-xs"><StatCard label={t.waste.monthTotal} value={formatTHB(monthTotal)} /></div> : null}
      <WasteBoard items={items} history={history} showCost={showCost} />
    </div>
  );
}

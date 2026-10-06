import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { integrityIssues, listStockLevels, listTransactions } from '@/server/repositories/inventory';
import { getT } from '@/i18n/server';
import { PageHeader, StatCard } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { StockTable } from '@/components/inventory/stock-table';
import { can, FRONT_OF_HOUSE } from '@/domain/permissions';
import { formatAmount, formatQty, formatTHB } from '@/domain/money';
import { formatDateTime } from '@/domain/datetime';

export default async function InventoryPage() {
  const employee = await requireEmployee(FRONT_OF_HOUSE);
  const canManage = can(employee.role, 'adjustInventory');
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const [levels, txns, issues] = await Promise.all([
    listStockLevels(db),
    canManage ? listTransactions(db, { limit: 300 }) : Promise.resolve([]),
    canManage ? integrityIssues(db) : Promise.resolve([]),
  ]);
  const names = new Map(levels.map((l) => [l.id, l]));
  const value = levels.reduce((s, l) => s + l.stock_value, 0);
  const low = levels.filter((l) => l.is_low).length;

  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.inventory.title} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {canManage ? <StatCard label={t.inventory.stockValue} value={formatTHB(value)} /> : null}
        <StatCard label={t.inventory.lowItems} value={low} tone={low ? 'destructive' : 'success'} />
        {canManage ? (
          <StatCard label="Ledger" value={issues.length ? t.inventory.integrityBad : '✓'} hint={issues.length ? `${issues.length}` : t.inventory.integrityOk}
            tone={issues.length ? 'destructive' : 'success'} />
        ) : null}
      </div>
      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">{t.inventory.title}</TabsTrigger>
          {canManage ? <TabsTrigger value="moves">{t.inventory.movements}</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="stock" className="mt-4"><StockTable items={levels} canManage={canManage} /></TabsContent>
        {canManage ? (
          <TabsContent value="moves" className="mt-4">
            <Table>
              <THead><TR><TH>{t.common.date}</TH><TH>{t.common.name}</TH><TH>{t.common.type}</TH><TH className="text-right">{t.common.quantity}</TH><TH className="text-right">{t.common.cost}</TH><TH className="text-right">{t.inventory.balance}</TH><TH>{t.inventory.reference}</TH></TR></THead>
              <TBody>
                {txns.map((x) => {
                  const item = names.get(x.ingredient_id);
                  return (
                    <TR key={x.id}>
                      <TD className="whitespace-nowrap text-xs">{formatDateTime(x.created_at)}</TD>
                      <TD>{item?.name_th ?? '—'}</TD>
                      <TD><Badge variant={x.quantity > 0 ? 'success' : x.transaction_type === 'WASTE' ? 'destructive' : 'secondary'}>{t.inventory.txn[x.transaction_type]}</Badge></TD>
                      <TD className={`text-right tabular-nums ${x.quantity > 0 ? 'text-success-strong' : 'text-destructive'}`}>{x.quantity > 0 ? '+' : ''}{formatQty(x.quantity)} {item?.unit}</TD>
                      <TD className="text-right tabular-nums">{formatAmount(Math.abs(x.total_cost))}</TD>
                      <TD className="text-right tabular-nums">{x.balance_after === null ? '—' : formatQty(x.balance_after)}</TD>
                      <TD className="max-w-48 truncate text-xs text-muted-foreground">{x.note ?? x.reference_type}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

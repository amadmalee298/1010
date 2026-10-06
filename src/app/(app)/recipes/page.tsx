import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listProducts } from '@/server/repositories/catalog';
import { listActiveRecipeCosts } from '@/server/repositories/recipes';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatAmount, formatPercent, formatQty } from '@/domain/money';
import { marginBand } from '@/domain/costing';
import { MANAGEMENT } from '@/domain/permissions';

export default async function RecipesPage() {
  await requireEmployee(MANAGEMENT);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const [products, costs] = await Promise.all([listProducts(db, { activeOnly: true }), listActiveRecipeCosts(db)]);
  const byProduct = new Map(costs.map((c) => [c.product_id, c]));
  const rows = products.filter((p) => p.inventory_mode !== 'NONE');
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.nav.recipes} description={t.catalog.recipeVersionNote} />
      <Table>
        <THead>
          <TR>
            <TH>{t.nav.products}</TH><TH>{t.catalog.recipe}</TH><TH className="text-right">{t.catalog.yieldQuantity}</TH>
            <TH className="text-right">{t.catalog.recipeCost}</TH><TH className="text-right">{t.catalog.costPerSellingUnit}</TH>
            <TH className="text-right">{t.catalog.sellingPrice}</TH><TH className="text-right">{t.catalog.grossProfit}</TH><TH className="text-right">{t.catalog.grossMargin}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((p) => {
            const c = byProduct.get(p.id);
            const band = marginBand(c?.gross_margin ?? null);
            return (
              <TR key={p.id}>
                <TD><Link className="font-medium text-primary-strong hover:underline" href={`/recipes/${p.id}`}>{p.name_th}</Link></TD>
                <TD>{c ? `${c.name} · v${c.version}` : <Badge variant="warning">{t.catalog.noRecipe}</Badge>}</TD>
                <TD className="text-right tabular-nums">{c ? `${formatQty(c.yield_quantity)} ${c.yield_unit}` : '—'}</TD>
                <TD className="text-right tabular-nums">{c ? formatAmount(c.recipe_cost) : '—'}</TD>
                <TD className="text-right tabular-nums">{c ? formatAmount(c.cost_per_selling_unit) : '—'}</TD>
                <TD className="text-right tabular-nums">{formatAmount(p.price)}</TD>
                <TD className="text-right tabular-nums">{c ? formatAmount(c.gross_profit) : '—'}</TD>
                <TD className="text-right">
                  {c?.gross_margin == null ? '—' : <Badge variant={band === 'good' ? 'success' : band === 'fair' ? 'warning' : 'destructive'}>{formatPercent(c.gross_margin)}</Badge>}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}

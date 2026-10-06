import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { getProduct } from '@/server/repositories/catalog';
import { listIngredients } from '@/server/repositories/ingredients';
import { getActiveRecipe, listRecipeHistory } from '@/server/repositories/recipes';
import { getSettings, vatConfig } from '@/server/repositories/settings';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { RecipeEditor } from '@/components/catalog/recipe-editor';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatAmount, formatPercent } from '@/domain/money';
import { MANAGEMENT } from '@/domain/permissions';

export default async function RecipeEditPage({ params }: { params: Promise<{ productId: string }> }) {
  await requireEmployee(MANAGEMENT);
  const { productId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(productId)) notFound();
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const product = await getProduct(db, productId);
  if (!product) notFound();
  const [active, history, ingredients, settings] = await Promise.all([
    getActiveRecipe(db, productId), listRecipeHistory(db, productId), listIngredients(db, { activeOnly: true, type: 'RAW' }), getSettings(db),
  ]);
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={`${active ? t.catalog.editRecipe : t.catalog.createRecipe}: ${product.name_th}`} />
      <RecipeEditor
        productId={product.id}
        productName={product.name_th}
        price={product.price}
        vat={vatConfig(settings)}
        ingredients={ingredients}
        recipe={active?.recipe ?? null}
        initialItems={active?.items.map((i) => ({ ingredient_id: i.ingredient_id, quantity: i.quantity })) ?? []}
      />
      {history.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">{t.catalog.history}</h2>
          <Table>
            <THead><TR><TH>{t.catalog.version}</TH><TH>{t.catalog.recipeName}</TH><TH className="text-right">{t.catalog.recipeCost}</TH><TH className="text-right">{t.catalog.costPerSellingUnit}</TH><TH className="text-right">{t.catalog.grossMargin}</TH><TH>{t.common.status}</TH></TR></THead>
            <TBody>
              {history.map((h) => (
                <TR key={h.recipe_id}>
                  <TD>v{h.version}</TD><TD>{h.name}</TD>
                  <TD className="text-right tabular-nums">{formatAmount(h.recipe_cost)}</TD>
                  <TD className="text-right tabular-nums">{formatAmount(h.cost_per_selling_unit)}</TD>
                  <TD className="text-right">{h.gross_margin == null ? '—' : formatPercent(h.gross_margin)}</TD>
                  <TD>{h.is_active ? t.common.active : t.common.inactive}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      ) : null}
    </div>
  );
}

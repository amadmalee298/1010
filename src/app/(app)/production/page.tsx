import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listProducts } from '@/server/repositories/catalog';
import { listActiveRecipeCosts } from '@/server/repositories/recipes';
import { listProduction } from '@/server/repositories/operations';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { ProductionBoard, type ProducibleProduct } from '@/components/operations/production-board';
import { MANAGEMENT } from '@/domain/permissions';

export default async function ProductionPage() {
  await requireEmployee(MANAGEMENT);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const [products, recipes, runs] = await Promise.all([listProducts(db), listActiveRecipeCosts(db), listProduction(db)]);
  const recipeBy = new Map(recipes.map((r) => [r.product_id, r]));
  const producible: ProducibleProduct[] = products
    .filter((p) => p.is_active && p.inventory_mode === 'FINISHED_GOOD' && recipeBy.has(p.id))
    .map((p) => ({ id: p.id, name: p.name_th, yieldPerBatch: recipeBy.get(p.id)?.yield_quantity ?? 0 }));
  const names = Object.fromEntries(products.map((p) => [p.id, p.name_th]));
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.production.title} description={t.production.onlyFinished} />
      <ProductionBoard runs={runs} products={producible} productNames={names} />
    </div>
  );
}

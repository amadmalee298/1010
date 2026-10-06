import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listIngredientCategories, listIngredients } from '@/server/repositories/ingredients';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { IngredientManager } from '@/components/catalog/ingredient-manager';
import { MANAGEMENT } from '@/domain/permissions';

export default async function IngredientsPage() {
  await requireEmployee(MANAGEMENT);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const [ingredients, categories] = await Promise.all([listIngredients(db), listIngredientCategories(db)]);
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.nav.ingredients} description={t.catalog.stockReadonly} />
      <IngredientManager ingredients={ingredients} categories={categories} />
    </div>
  );
}

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listCategories, listProducts } from '@/server/repositories/catalog';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { CategoryManager } from '@/components/catalog/category-manager';
import { MANAGEMENT } from '@/domain/permissions';

export default async function CategoriesPage() {
  await requireEmployee(MANAGEMENT);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const [categories, products] = await Promise.all([listCategories(db), listProducts(db)]);
  const counts: Record<string, number> = {};
  for (const p of products) if (p.category_id && p.is_active) counts[p.category_id] = (counts[p.category_id] ?? 0) + 1;
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.nav.categories} />
      <CategoryManager categories={categories} counts={counts} />
    </div>
  );
}

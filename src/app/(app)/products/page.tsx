import { createSupabaseServerClient } from '@/lib/supabase/server';
import { requireEmployee } from '@/server/auth';
import { listCategories, listProductCosts, listProducts, productImageUrl } from '@/server/repositories/catalog';
import { getT } from '@/i18n/server';
import { PageHeader } from '@/components/ui/misc';
import { ProductManager, type ProductListItem } from '@/components/catalog/product-manager';
import { MANAGEMENT } from '@/domain/permissions';

export default async function ProductsPage() {
  await requireEmployee(MANAGEMENT);
  const [t, db] = await Promise.all([getT(), createSupabaseServerClient()]);
  const [products, categories, costs] = await Promise.all([listProducts(db), listCategories(db), listProductCosts(db)]);
  const costById = new Map(costs.map((c) => [c.product_id, c]));
  const items: ProductListItem[] = products.map((p) => ({ ...p, imageUrl: productImageUrl(db, p.image_path), cost: costById.get(p.id) ?? null }));
  return (
    <div className="p-4 lg:p-6">
      <PageHeader title={t.nav.products} />
      <ProductManager products={items} categories={categories} />
    </div>
  );
}

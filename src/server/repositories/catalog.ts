import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import type { CategoryInput, ProductInput } from '@/domain/schemas/catalog';
import type { Tables, Views } from '@/lib/database.types';
import { unwrap, unwrapMaybe } from '../db';

export type Category = Tables<'categories'>;
export type Product = Tables<'products'>;
export type ProductCost = Views<'product_costs'>;

export async function listCategories(db: SupabaseServerClient, { activeOnly = false } = {}): Promise<Category[]> {
  let q = db.from('categories').select('*').order('sort_order').order('name_th');
  if (activeOnly) q = q.eq('is_active', true);
  return unwrap(await q);
}

export async function saveCategory(db: SupabaseServerClient, input: CategoryInput): Promise<Category> {
  const row = { name_th: input.name_th, name_en: input.name_en ?? null, sort_order: input.sort_order, is_active: input.is_active };
  return input.id
    ? unwrap(await db.from('categories').update(row).eq('id', input.id).select().single())
    : unwrap(await db.from('categories').insert(row).select().single());
}

export async function listProducts(db: SupabaseServerClient, { activeOnly = false } = {}): Promise<Product[]> {
  let q = db.from('products').select('*').order('sort_order').order('name_th');
  if (activeOnly) q = q.eq('is_active', true);
  return unwrap(await q);
}

export async function getProduct(db: SupabaseServerClient, id: string): Promise<Product | null> {
  return unwrapMaybe(await db.from('products').select('*').eq('id', id).maybeSingle());
}

export async function saveProduct(db: SupabaseServerClient, input: ProductInput, imagePath?: string | null): Promise<Product> {
  const row = {
    category_id: input.category_id ?? null,
    sku: input.sku ?? null,
    name_th: input.name_th,
    name_en: input.name_en ?? null,
    description: input.description ?? null,
    price: input.price,
    inventory_mode: input.inventory_mode,
    sort_order: input.sort_order,
    is_active: input.is_active,
    ...(imagePath !== undefined ? { image_path: imagePath } : {}),
  };
  return input.id
    ? unwrap(await db.from('products').update(row).eq('id', input.id).select().single())
    : unwrap(await db.from('products').insert(row).select().single());
}

export async function listProductCosts(db: SupabaseServerClient): Promise<ProductCost[]> {
  return unwrap(await db.from('product_costs').select('*'));
}

export const PRODUCT_IMAGE_BUCKET = 'product-images';

export async function uploadProductImage(db: SupabaseServerClient, productId: string, file: File): Promise<string> {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${productId}/${Date.now()}.${ext}`;
  const { error } = await db.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return path;
}

export function productImageUrl(db: SupabaseServerClient, path: string | null): string | null {
  return path ? db.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl : null;
}

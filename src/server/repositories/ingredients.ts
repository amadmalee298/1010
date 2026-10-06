import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import type { IngredientInput } from '@/domain/schemas/catalog';
import type { Tables } from '@/lib/database.types';
import { unwrap } from '../db';

export type Ingredient = Tables<'ingredients'>;
export type IngredientCategory = Tables<'ingredient_categories'>;

export async function listIngredients(
  db: SupabaseServerClient,
  { activeOnly = false, type }: { activeOnly?: boolean; type?: 'RAW' | 'FINISHED' } = {},
): Promise<Ingredient[]> {
  let q = db.from('ingredients').select('*').order('item_type').order('name_th');
  if (activeOnly) q = q.eq('is_active', true);
  if (type) q = q.eq('item_type', type);
  return unwrap(await q);
}

export async function listIngredientCategories(db: SupabaseServerClient): Promise<IngredientCategory[]> {
  return unwrap(await db.from('ingredient_categories').select('*').order('name_th'));
}

export async function createIngredientCategory(db: SupabaseServerClient, name_th: string, name_en?: string): Promise<IngredientCategory> {
  return unwrap(await db.from('ingredient_categories').insert({ name_th, name_en: name_en ?? null }).select().single());
}

/** Master data only — stock and cost change exclusively through inventory transactions. */
export async function saveIngredient(db: SupabaseServerClient, input: IngredientInput): Promise<Ingredient> {
  const row = {
    category_id: input.category_id ?? null,
    sku: input.sku ?? null,
    name_th: input.name_th,
    name_en: input.name_en ?? null,
    unit: input.unit,
    reorder_level: input.reorder_level,
    allow_negative: input.allow_negative,
    is_active: input.is_active,
  };
  return input.id
    ? unwrap(await db.from('ingredients').update(row).eq('id', input.id).select().single())
    : unwrap(await db.from('ingredients').insert({ ...row, item_type: 'RAW' }).select().single());
}

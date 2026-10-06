import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import type { RecipeInput } from '@/domain/schemas/catalog';
import type { Tables, Views } from '@/lib/database.types';
import { unwrap, unwrapMaybe } from '../db';

export type Recipe = Tables<'recipes'>;
export type RecipeCost = Views<'recipe_costs'>;
export type RecipeItemCost = Views<'recipe_item_costs'>;

export async function getActiveRecipe(db: SupabaseServerClient, productId: string): Promise<{ recipe: Recipe; items: RecipeItemCost[] } | null> {
  const res = await db.from('recipes').select('*').eq('product_id', productId).eq('is_active', true).maybeSingle();
  const recipe: Recipe | null = unwrapMaybe(res);
  if (!recipe) return null;
  const items = unwrap(await db.from('recipe_item_costs').select('*').eq('recipe_id', recipe.id).order('ingredient_name'));
  return { recipe, items };
}

export async function listRecipeHistory(db: SupabaseServerClient, productId: string): Promise<RecipeCost[]> {
  return unwrap(await db.from('recipe_costs').select('*').eq('product_id', productId).order('version', { ascending: false }));
}

export async function listActiveRecipeCosts(db: SupabaseServerClient): Promise<RecipeCost[]> {
  return unwrap(await db.from('recipe_costs').select('*').eq('is_active', true).order('product_name'));
}

export async function saveRecipe(db: SupabaseServerClient, input: RecipeInput): Promise<string> {
  return unwrap(await db.rpc('save_recipe', {
    p_product_id: input.product_id,
    p_name: input.name,
    p_yield_quantity: input.yield_quantity,
    p_yield_unit: input.yield_unit,
    p_units_per_sale: input.units_per_sale,
    p_items: input.items.map((i) => ({ ingredient_id: i.ingredient_id, quantity: i.quantity, note: i.note ?? null })),
    p_note: input.note ?? null,
  }));
}

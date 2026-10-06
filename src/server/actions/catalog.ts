'use server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { defineAction, ActionError } from '../action';
import { MANAGEMENT } from '@/domain/permissions';
import {
  categorySchema, ingredientCategorySchema, ingredientSchema, productSchema, recipeSchema, IMAGE_MAX_BYTES, IMAGE_TYPES,
} from '@/domain/schemas/catalog';
import { uuid } from '@/domain/schemas/common';
import * as catalog from '../repositories/catalog';
import * as ingredients from '../repositories/ingredients';
import * as recipes from '../repositories/recipes';

export const saveCategoryAction = defineAction({
  input: categorySchema,
  roles: MANAGEMENT,
  revalidate: ['/categories', '/products', '/pos'],
  handler: async (input) => catalog.saveCategory(await createSupabaseServerClient(), input),
});

export const saveProductAction = defineAction({
  input: productSchema,
  roles: MANAGEMENT,
  revalidate: ['/products', '/pos', '/recipes'],
  handler: async (input) => catalog.saveProduct(await createSupabaseServerClient(), input),
});

const imageUpload = z.object({
  productId: uuid,
  file: z.instanceof(File)
    .refine((f) => f.size > 0 && f.size <= IMAGE_MAX_BYTES, 'file size')
    .refine((f) => (IMAGE_TYPES as readonly string[]).includes(f.type), 'file type'),
});

export async function uploadProductImageAction(formData: FormData) {
  return defineAction({
    input: imageUpload,
    roles: MANAGEMENT,
    revalidate: ['/products', '/pos'],
    handler: async ({ productId, file }) => {
      const db = await createSupabaseServerClient();
      const product = await catalog.getProduct(db, productId);
      if (!product) throw new ActionError('NOT_FOUND');
      const path = await catalog.uploadProductImage(db, productId, file);
      const { error } = await db.from('products').update({ image_path: path }).eq('id', productId);
      if (error) throw new ActionError(error.message);
      if (product.image_path) await db.storage.from(catalog.PRODUCT_IMAGE_BUCKET).remove([product.image_path]);
      return { path };
    },
  })({ productId: formData.get('productId'), file: formData.get('file') });
}

export const saveIngredientAction = defineAction({
  input: ingredientSchema,
  roles: MANAGEMENT,
  revalidate: ['/ingredients', '/inventory', '/recipes'],
  handler: async (input) => ingredients.saveIngredient(await createSupabaseServerClient(), input),
});

export const createIngredientCategoryAction = defineAction({
  input: ingredientCategorySchema,
  roles: MANAGEMENT,
  revalidate: ['/ingredients'],
  handler: async (input) => ingredients.createIngredientCategory(await createSupabaseServerClient(), input.name_th, input.name_en),
});

export const saveRecipeAction = defineAction({
  input: recipeSchema,
  roles: MANAGEMENT,
  revalidate: ['/recipes', '/products'],
  handler: async (input) => ({ recipeId: await recipes.saveRecipe(await createSupabaseServerClient(), input) }),
});

import { z } from 'zod';
import { checkbox, money, nonNegativeQty, optionalText, optionalUuid, quantity, requiredText, uuid } from './common';

export const categorySchema = z.object({
  id: optionalUuid,
  name_th: requiredText(100),
  name_en: optionalText(100),
  sort_order: z.coerce.number().int().min(0).max(10_000).default(0),
  is_active: checkbox.default(true),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const productSchema = z.object({
  id: optionalUuid,
  category_id: optionalUuid,
  sku: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().regex(/^[A-Za-z0-9_-]{1,30}$/).optional()),
  name_th: requiredText(150),
  name_en: optionalText(150),
  description: optionalText(500),
  price: money,
  inventory_mode: z.enum(['RECIPE', 'FINISHED_GOOD', 'NONE']),
  sort_order: z.coerce.number().int().min(0).max(10_000).default(0),
  is_active: checkbox.default(true),
});
export type ProductInput = z.infer<typeof productSchema>;

export const ingredientSchema = z.object({
  id: optionalUuid,
  category_id: optionalUuid,
  sku: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().regex(/^[A-Za-z0-9_-]{1,30}$/).optional()),
  name_th: requiredText(150),
  name_en: optionalText(150),
  unit: requiredText(20),
  reorder_level: nonNegativeQty.default(0),
  allow_negative: checkbox.default(false),
  is_active: checkbox.default(true),
});
export type IngredientInput = z.infer<typeof ingredientSchema>;

export const ingredientCategorySchema = z.object({ name_th: requiredText(100), name_en: optionalText(100) });

export const recipeSchema = z.object({
  product_id: uuid,
  name: requiredText(100),
  yield_quantity: quantity,
  yield_unit: requiredText(20),
  units_per_sale: quantity.default(1),
  note: optionalText(500),
  items: z.array(z.object({ ingredient_id: uuid, quantity, note: optionalText(200) })).min(1).max(100)
    .refine((items) => new Set(items.map((i) => i.ingredient_id)).size === items.length, 'duplicate ingredient'),
});
export type RecipeInput = z.infer<typeof recipeSchema>;

export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/**
 * Recipe & menu costing — pure functions.
 * Mirrors the SQL views `recipe_costs` / `product_costs` (see migration phase 2–3);
 * test/db/phase2-3-catalog.test.ts asserts both produce identical numbers.
 */
import { round4 } from './money';

export interface VatConfig { enabled: boolean; inclusive: boolean; rate: number }
export const NO_VAT: VatConfig = { enabled: false, inclusive: true, rate: 7 };

export interface CostLine {
  ingredientId: string;
  quantity: number;   // per batch, in the ingredient's base unit
  unitCost: number;   // weighted average cost per base unit
}

export interface RecipeShape {
  yieldQuantity: number;  // yield units produced by one batch
  unitsPerSale: number;   // yield units consumed by one sold product
  lines: readonly CostLine[];
}

export interface RecipeCost {
  ingredientCosts: { ingredientId: string; lineCost: number }[];
  recipeCost: number;          // one batch
  costPerYield: number;        // one yield unit
  costPerSellingUnit: number;  // one sold product
  netPrice: number;            // selling price excluding VAT (when VAT inclusive)
  grossProfit: number;
  grossMargin: number | null;  // ratio 0..1, null when price is 0
}

export function netOfVat(price: number, vat: VatConfig): number {
  if (!vat.enabled || !vat.inclusive) return price;
  return round4((price * 100) / (100 + vat.rate));
}

export function costRecipe(recipe: RecipeShape, sellingPrice: number, vat: VatConfig = NO_VAT): RecipeCost {
  if (!(recipe.yieldQuantity > 0)) throw new RangeError('yieldQuantity must be > 0');
  if (!(recipe.unitsPerSale > 0)) throw new RangeError('unitsPerSale must be > 0');
  const ingredientCosts = recipe.lines.map((l) => ({ ingredientId: l.ingredientId, lineCost: round4(l.quantity * l.unitCost) }));
  const recipeCost = round4(ingredientCosts.reduce((s, l) => s + l.lineCost, 0));
  const costPerYield = round4(recipeCost / recipe.yieldQuantity);
  const costPerSellingUnit = round4((recipeCost / recipe.yieldQuantity) * recipe.unitsPerSale);
  const netPrice = netOfVat(sellingPrice, vat);
  const grossProfit = round4(netPrice - (recipeCost / recipe.yieldQuantity) * recipe.unitsPerSale);
  const grossMargin = netPrice > 0 ? round4(grossProfit / netPrice) : null;
  return { ingredientCosts, recipeCost, costPerYield, costPerSellingUnit, netPrice, grossProfit, grossMargin };
}

/** Ingredient quantity consumed when selling `soldQty` products made by this recipe. */
export function usagePerSale(recipe: RecipeShape, soldQty: number): { ingredientId: string; quantity: number }[] {
  const factor = (recipe.unitsPerSale / recipe.yieldQuantity) * soldQty;
  return recipe.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: round4(l.quantity * factor) }));
}

/** Margin health band used to colour menu-profitability tables. */
export function marginBand(margin: number | null): 'good' | 'fair' | 'poor' | 'unknown' {
  if (margin === null) return 'unknown';
  if (margin >= 0.6) return 'good';
  if (margin >= 0.4) return 'fair';
  return 'poor';
}

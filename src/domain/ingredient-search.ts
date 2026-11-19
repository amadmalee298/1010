export interface IngredientOption { name_th: string; name_en: string | null; sku: string | null; unit: string }

/** Ingredients whose Thai/English name or code contains the typed text (case-insensitive), at most `limit`. */
export function matchIngredients(options: readonly IngredientOption[], text: string, limit = 6): IngredientOption[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  return options
    .filter((o) => [o.name_th, o.name_en, o.sku].some((v) => v?.toLowerCase().includes(q)) && o.name_th.trim() !== text.trim())
    .slice(0, limit);
}

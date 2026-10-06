'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useI18n } from '@/i18n/client';
import { useAction } from '@/hooks/use-action';
import { costRecipe, marginBand, type VatConfig } from '@/domain/costing';
import { formatAmount, formatPercent } from '@/domain/money';
import { saveRecipeAction } from '@/server/actions/catalog';
import type { IngredientRow, RecipeRow } from '@/lib/database.types';

interface Line { key: number; ingredientId: string; quantity: string }

export function RecipeEditor({ productId, productName, price, vat, ingredients, recipe, initialItems }: {
  productId: string;
  productName: string;
  price: number;
  vat: VatConfig;
  ingredients: IngredientRow[];
  recipe: RecipeRow | null;
  initialItems: { ingredient_id: string; quantity: number }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { run, pending } = useAction(saveRecipeAction, { successMessage: t.catalog.savedNewVersion });
  const [name, setName] = useState(recipe?.name ?? productName);
  const [yieldQty, setYieldQty] = useState(String(recipe?.yield_quantity ?? 1));
  const [yieldUnit, setYieldUnit] = useState(recipe?.yield_unit ?? 'ชิ้น');
  const [unitsPerSale, setUnitsPerSale] = useState(String(recipe?.units_per_sale ?? 1));
  const [note, setNote] = useState(recipe?.note ?? '');
  const [lines, setLines] = useState<Line[]>(
    initialItems.length ? initialItems.map((i, k) => ({ key: k, ingredientId: i.ingredient_id, quantity: String(i.quantity) })) : [{ key: 0, ingredientId: '', quantity: '' }],
  );
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  const valid = Number(yieldQty) > 0 && Number(unitsPerSale) > 0;
  const cost = useMemo(() => valid
    ? costRecipe({
        yieldQuantity: Number(yieldQty),
        unitsPerSale: Number(unitsPerSale),
        lines: lines.filter((l) => l.ingredientId && Number(l.quantity) > 0)
          .map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity), unitCost: byId.get(l.ingredientId)?.avg_cost ?? 0 })),
      }, price, vat)
    : null, [valid, yieldQty, unitsPerSale, lines, byId, price, vat]);
  const band = marginBand(cost?.grossMargin ?? null);
  const lineCost = (l: Line) => cost?.ingredientCosts.find((c) => c.ingredientId === l.ingredientId)?.lineCost;
  const used = new Set(lines.map((l) => l.ingredientId));

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function submit() {
    const res = await run({
      product_id: productId, name, yield_quantity: yieldQty, yield_unit: yieldUnit, units_per_sale: unitsPerSale, note,
      items: lines.filter((l) => l.ingredientId).map((l) => ({ ingredient_id: l.ingredientId, quantity: l.quantity })),
    });
    if (res) router.push('/recipes');
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <Card>
        <CardContent className="grid gap-4 pt-5">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label={t.catalog.recipeName} className="sm:col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></Field>
            <Field label={t.catalog.yieldQuantity}><Input type="number" inputMode="decimal" min={0} step="any" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} /></Field>
            <Field label={t.catalog.yieldUnit}><Input value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} maxLength={20} /></Field>
            <Field label={t.catalog.unitsPerSale} hint={t.catalog.unitsPerSaleHint}><Input type="number" inputMode="decimal" min={0} step="any" value={unitsPerSale} onChange={(e) => setUnitsPerSale(e.target.value)} /></Field>
            <Field label={t.common.note} className="sm:col-span-3"><Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-11" maxLength={500} /></Field>
          </div>

          <Table>
            <THead><TR><TH>{t.catalog.ingredients}</TH><TH className="w-40">{t.common.quantity} ({t.catalog.perBatch})</TH><TH className="text-right">{t.catalog.avgCost}</TH><TH className="text-right">{t.catalog.lineCost}</TH><TH /></TR></THead>
            <TBody>
              {lines.map((l) => {
                const ing = byId.get(l.ingredientId);
                const lc = lineCost(l);
                return (
                  <TR key={l.key}>
                    <TD>
                      <NativeSelect value={l.ingredientId} onChange={(e) => update(l.key, { ingredientId: e.target.value })} aria-label={t.catalog.selectIngredient}>
                        <option value="">{t.catalog.selectIngredient}</option>
                        {ingredients.filter((i) => i.id === l.ingredientId || !used.has(i.id)).map((i) => (
                          <option key={i.id} value={i.id}>{i.name_th} ({i.unit})</option>
                        ))}
                      </NativeSelect>
                    </TD>
                    <TD><Input type="number" inputMode="decimal" min={0} step="any" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} aria-label={t.common.quantity} /></TD>
                    <TD className="text-right tabular-nums">{ing ? `${formatAmount(ing.avg_cost)}/${ing.unit}` : '—'}</TD>
                    <TD className="text-right tabular-nums">{lc === undefined ? '—' : formatAmount(lc)}</TD>
                    <TD><Button variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t.common.delete}><Trash2 /></Button></TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="outline" onClick={() => setLines((ls) => [...ls, { key: Math.max(0, ...ls.map((x) => x.key)) + 1, ingredientId: '', quantity: '' }])}>
              <Plus /> {t.catalog.addIngredient}
            </Button>
            <Button size="lg" onClick={submit} disabled={pending || !valid}>{t.common.save}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{t.catalog.recipeVersionNote}</p>
        </CardContent>
      </Card>

      <div className="grid content-start gap-3">
        <Card>
          <CardHeader><CardTitle>{productName}</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <StatCard label={t.catalog.recipeCost} value={cost ? formatAmount(cost.recipeCost) : '—'} />
            <StatCard label={t.catalog.costPerYield} value={cost ? formatAmount(cost.costPerYield) : '—'} />
            <StatCard label={t.catalog.costPerSellingUnit} value={cost ? formatAmount(cost.costPerSellingUnit) : '—'} />
            <StatCard label={t.catalog.netPrice} value={cost ? formatAmount(cost.netPrice) : formatAmount(price)} />
            <StatCard label={t.catalog.grossProfit} value={cost ? formatAmount(cost.grossProfit) : '—'} tone={cost && cost.grossProfit < 0 ? 'destructive' : 'default'} />
            <StatCard label={t.catalog.grossMargin} value={cost?.grossMargin == null ? '—' : formatPercent(cost.grossMargin)}
              tone={band === 'good' ? 'success' : band === 'fair' ? 'warning' : band === 'poor' ? 'destructive' : 'default'} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

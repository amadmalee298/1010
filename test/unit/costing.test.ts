import { describe, expect, it } from 'vitest';
import { costRecipe, marginBand, netOfVat, usagePerSale } from '@/domain/costing';

// Caramel Custard: 12 pieces per batch
const caramelCustard = {
  yieldQuantity: 12,
  unitsPerSale: 1,
  lines: [
    { ingredientId: 'egg', quantity: 10, unitCost: 4.5 },        // 45.00
    { ingredientId: 'milk', quantity: 1000, unitCost: 0.055 },   // 55.00
    { ingredientId: 'sugar', quantity: 200, unitCost: 0.03 },    // 6.00
    { ingredientId: 'cream', quantity: 250, unitCost: 0.16 },    // 40.00
    { ingredientId: 'vanilla', quantity: 5, unitCost: 2 },       // 10.00
    { ingredientId: 'caramel', quantity: 150, unitCost: 0.08 },  // 12.00
  ],
};

describe('costRecipe', () => {
  it('computes ingredient, recipe, yield and selling-unit costs', () => {
    const c = costRecipe(caramelCustard, 59);
    expect(c.ingredientCosts.map((l) => l.lineCost)).toEqual([45, 55, 6, 40, 10, 12]);
    expect(c.recipeCost).toBe(168);
    expect(c.costPerYield).toBe(14);
    expect(c.costPerSellingUnit).toBe(14);
    expect(c.grossProfit).toBe(45);
    expect(c.grossMargin).toBeCloseTo(0.7627, 4);
  });

  it('scales by units per sale (e.g. a box of 4)', () => {
    const c = costRecipe({ ...caramelCustard, unitsPerSale: 4 }, 199);
    expect(c.costPerSellingUnit).toBe(56);
    expect(c.grossProfit).toBe(143);
  });

  it('uses net price when VAT is inclusive', () => {
    expect(netOfVat(107, { enabled: true, inclusive: true, rate: 7 })).toBe(100);
    expect(netOfVat(107, { enabled: true, inclusive: false, rate: 7 })).toBe(107);
    const c = costRecipe(caramelCustard, 107, { enabled: true, inclusive: true, rate: 7 });
    expect(c.netPrice).toBe(100);
    expect(c.grossProfit).toBe(86);
  });

  it('handles zero price and rejects invalid yields', () => {
    expect(costRecipe(caramelCustard, 0).grossMargin).toBeNull();
    expect(() => costRecipe({ ...caramelCustard, yieldQuantity: 0 }, 10)).toThrow(RangeError);
    expect(() => costRecipe({ ...caramelCustard, unitsPerSale: -1 }, 10)).toThrow(RangeError);
  });

  it('handles an empty recipe as zero cost', () => {
    const c = costRecipe({ yieldQuantity: 1, unitsPerSale: 1, lines: [] }, 50);
    expect(c.recipeCost).toBe(0);
    expect(c.grossMargin).toBe(1);
  });
});

describe('usagePerSale', () => {
  it('derives ingredient usage for sold units', () => {
    const u = usagePerSale(caramelCustard, 3);
    expect(u.find((l) => l.ingredientId === 'egg')?.quantity).toBe(2.5);
    expect(u.find((l) => l.ingredientId === 'milk')?.quantity).toBe(250);
  });
});

describe('marginBand', () => {
  it('classifies margins', () => {
    expect(marginBand(0.7)).toBe('good');
    expect(marginBand(0.45)).toBe('fair');
    expect(marginBand(0.1)).toBe('poor');
    expect(marginBand(null)).toBe('unknown');
  });
});

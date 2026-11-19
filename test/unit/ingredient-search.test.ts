import { describe, expect, it } from 'vitest';
import { matchIngredients, type IngredientOption } from '@/domain/ingredient-search';

const opts: IngredientOption[] = [
  { name_th: 'ไข่ไก่เบอร์ 2', name_en: 'Egg', sku: 'EGG2', unit: 'ฟอง' },
  { name_th: 'นมข้น 2000 กรัม', name_en: null, sku: null, unit: 'กรัม' },
  { name_th: 'เมจิ 2000 มล.', name_en: 'Meiji milk', sku: null, unit: 'มล.' },
  { name_th: 'กล่อง F500', name_en: null, sku: 'F500', unit: 'ใบ' },
];

describe('matchIngredients', () => {
  it('matches Thai names, English names and codes, ignoring case', () => {
    expect(matchIngredients(opts, 'ไข่').map((o) => o.name_th)).toEqual(['ไข่ไก่เบอร์ 2']);
    expect(matchIngredients(opts, 'MILK').map((o) => o.name_th)).toEqual(['เมจิ 2000 มล.']);
    expect(matchIngredients(opts, 'f500').map((o) => o.name_th)).toEqual(['กล่อง F500']);
    expect(matchIngredients(opts, '2000')).toHaveLength(2);
  });
  it('shows nothing for empty text or once a name is picked, and respects the limit', () => {
    expect(matchIngredients(opts, '  ')).toEqual([]);
    expect(matchIngredients(opts, 'กล่อง F500')).toEqual([]);
    expect(matchIngredients(opts, '0', 1)).toHaveLength(1);
  });
});

import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/database.types';
import type { VatConfig } from '@/domain/costing';
import { unwrap } from '../db';

export interface ShopSettings {
  shop_name: string; shop_address: string; shop_phone: string; tax_id: string;
  vat_enabled: boolean; vat_rate: number; vat_inclusive: boolean; promptpay_id: string;
  baht_per_point: number; point_value: number; min_redeem_points: number; max_cashier_discount: number;
  receipt_footer: string; locale: string;
}

export const DEFAULT_SETTINGS: ShopSettings = {
  shop_name: 'Custard', shop_address: '', shop_phone: '', tax_id: '', vat_enabled: false, vat_rate: 7, vat_inclusive: true,
  promptpay_id: '', baht_per_point: 25, point_value: 1, min_redeem_points: 10, max_cashier_discount: 50,
  receipt_footer: 'ขอบคุณค่ะ', locale: 'th',
};

function coerce<K extends keyof ShopSettings>(key: K, value: Json): ShopSettings[K] {
  const def = DEFAULT_SETTINGS[key];
  if (typeof def === 'number') return (typeof value === 'number' ? value : Number(value)) as ShopSettings[K];
  if (typeof def === 'boolean') return (value === true || value === 'true') as ShopSettings[K];
  return (typeof value === 'string' ? value : String(value ?? '')) as ShopSettings[K];
}

export async function getSettings(db: SupabaseServerClient): Promise<ShopSettings> {
  const rows = unwrap(await db.from('settings').select('key, value'));
  const out: ShopSettings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in DEFAULT_SETTINGS) {
      const key = r.key as keyof ShopSettings;
      (out as unknown as Record<string, unknown>)[key] = coerce(key, r.value);
    }
  }
  return out;
}

export const vatConfig = (s: ShopSettings): VatConfig => ({ enabled: s.vat_enabled, inclusive: s.vat_inclusive, rate: s.vat_rate });

import 'server-only';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import type { Tables } from '@/lib/database.types';
import type { PromotionRule } from '@/domain/pricing';
import type { PromotionInput } from '@/domain/schemas/customers';
import { unwrap } from '../db';

export type Promotion = Tables<'promotions'>;

export const toRule = (p: Promotion): PromotionRule => ({
  id: p.id, name: p.name, discountType: p.discount_type, value: p.value, minSubtotal: p.min_subtotal,
  maxDiscount: p.max_discount, membersOnly: p.members_only, startsAt: p.starts_at, endsAt: p.ends_at, isActive: p.is_active,
});

export async function listPromotions(db: SupabaseServerClient): Promise<Promotion[]> {
  return unwrap(await db.from('promotions').select('*').order('is_active', { ascending: false }).order('name'));
}

export async function listActivePromotions(db: SupabaseServerClient): Promise<PromotionRule[]> {
  const now = new Date().toISOString();
  const rows = unwrap(await db.from('promotions').select('*').eq('is_active', true)
    .or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`).order('name'));
  return rows.map(toRule);
}

/** datetime-local values are Bangkok wall-clock time; store as UTC instants. */
const bkkToIso = (v: string | undefined) => (v ? new Date(v.length === 16 ? `${v}:00+07:00` : v).toISOString() : null);

export async function savePromotion(db: SupabaseServerClient, input: PromotionInput): Promise<Promotion> {
  const row = {
    name: input.name, code: input.code ?? null, discount_type: input.discount_type, value: input.value,
    min_subtotal: input.min_subtotal, max_discount: input.max_discount ?? null, members_only: input.members_only,
    starts_at: bkkToIso(input.starts_at), ends_at: bkkToIso(input.ends_at), is_active: input.is_active,
  };
  return input.id
    ? unwrap(await db.from('promotions').update(row).eq('id', input.id).select().single())
    : unwrap(await db.from('promotions').insert(row).select().single());
}

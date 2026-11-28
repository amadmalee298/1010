-- Phase 27: buying units ("packs") for ingredients.
-- An ingredient is still counted in its base unit (ฟอง, กรัม, มล.), but it can also say how it is
-- bought: pack_unit 'แผง', pack_size 30 (base units per pack) and the last pack_price paid.
-- Screens then let staff enter "2 แผง" and store 60 ฟอง; pack_price pre-fills prices.

alter table public.ingredients
  add column pack_unit text check (pack_unit is null or length(trim(pack_unit)) between 1 and 20),
  add column pack_size numeric(14,4) check (pack_size is null or pack_size > 0),
  add column pack_price numeric(12,2) check (pack_price is null or pack_price >= 0),
  add constraint ingredients_pack_complete check ((pack_unit is null) = (pack_size is null));

grant insert (pack_unit, pack_size, pack_price) on public.ingredients to authenticated;
grant update (pack_unit, pack_size, pack_price) on public.ingredients to authenticated;

-- New columns go at the end so the view can be replaced in place.
create or replace view public.stock_levels with (security_invoker = true) as
select
  i.id, i.name_th, i.name_en, i.sku, i.unit, i.item_type, i.category_id, i.product_id,
  i.stock_qty, i.avg_cost, i.reorder_level, i.is_active,
  round(greatest(i.stock_qty, 0) * i.avg_cost, 2) as stock_value,
  (i.stock_qty <= i.reorder_level) as is_low,
  i.pack_unit, i.pack_size, i.pack_price
from public.ingredients i;

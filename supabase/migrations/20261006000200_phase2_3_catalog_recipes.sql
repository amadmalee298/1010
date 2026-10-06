-- =============================================================================
-- Phase 2–3: Catalog helpers, finished goods, recipe versioning, cost views,
-- product image storage.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Settings helpers
-- ---------------------------------------------------------------------------
create or replace function public.setting_numeric(p_key text, p_default numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from public.settings where key = p_key), p_default)
$$;

create or replace function public.setting_bool(p_key text, p_default boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::boolean from public.settings where key = p_key), p_default)
$$;

-- Selling price net of VAT (when VAT is enabled and prices include it).
create or replace function public.net_of_vat(p_amount numeric)
returns numeric language sql stable set search_path = public as $$
  select case
    when public.setting_bool('vat_enabled', false) and public.setting_bool('vat_inclusive', true)
      then round(p_amount * 100 / (100 + public.setting_numeric('vat_rate', 7)), 4)
    else p_amount
  end
$$;

-- ---------------------------------------------------------------------------
-- Finished goods: a product sold from produced stock owns one FINISHED item.
-- ---------------------------------------------------------------------------
create or replace function public.ensure_finished_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.inventory_mode = 'FINISHED_GOOD'
     and not exists (select 1 from public.ingredients where product_id = new.id) then
    insert into public.ingredients (name_th, name_en, unit, item_type, product_id, sku)
    values (new.name_th, new.name_en, 'ชิ้น', 'FINISHED', new.id, case when new.sku is null then null else 'FG-' || new.sku end);
  elsif new.inventory_mode = 'FINISHED_GOOD' then
    update public.ingredients set name_th = new.name_th, name_en = new.name_en, is_active = new.is_active
    where product_id = new.id;
  end if;
  return new;
end $$;

create trigger products_finished_item after insert or update of inventory_mode, name_th, name_en, is_active
  on public.products for each row execute function public.ensure_finished_item();

-- ---------------------------------------------------------------------------
-- Recipe versioning: save = deactivate current + insert new version atomically.
-- p_items: [{"ingredient_id": uuid, "quantity": number, "note": text?}, ...]
-- ---------------------------------------------------------------------------
create or replace function public.save_recipe(
  p_product_id uuid,
  p_name text,
  p_yield_quantity numeric,
  p_yield_unit text,
  p_units_per_sale numeric,
  p_items jsonb,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_old public.recipes;
  v_new_id uuid;
  v_version integer := 1;
  v_item jsonb;
  v_count integer;
begin
  perform public.require_role('OWNER', 'MANAGER');

  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'NOT_FOUND: product' using errcode = 'P0001';
  end if;
  if p_yield_quantity is null or p_yield_quantity <= 0 or p_units_per_sale is null or p_units_per_sale <= 0 then
    raise exception 'VALIDATION: yield and units per sale must be positive' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'VALIDATION: recipe needs at least one ingredient' using errcode = 'P0001';
  end if;
  select count(distinct (e ->> 'ingredient_id')) into v_count from jsonb_array_elements(p_items) e;
  if v_count <> jsonb_array_length(p_items) then
    raise exception 'VALIDATION: duplicate ingredient in recipe' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    join public.ingredients i on i.id = (e ->> 'ingredient_id')::uuid
    where i.product_id = p_product_id
  ) then
    raise exception 'VALIDATION: a recipe cannot consume its own finished good' using errcode = 'P0001';
  end if;

  select * into v_old from public.recipes where product_id = p_product_id and is_active for update;
  if found then
    update public.recipes set is_active = false where id = v_old.id;
    v_version := v_old.version + 1;
  end if;

  insert into public.recipes (product_id, name, version, yield_quantity, yield_unit, units_per_sale, note)
  values (p_product_id, coalesce(nullif(trim(p_name), ''), 'Recipe'), v_version, p_yield_quantity,
          coalesce(nullif(trim(p_yield_unit), ''), 'ชิ้น'), p_units_per_sale, p_note)
  returning id into v_new_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item ->> 'quantity')::numeric is null or (v_item ->> 'quantity')::numeric <= 0 then
      raise exception 'VALIDATION: ingredient quantity must be positive' using errcode = 'P0001';
    end if;
    insert into public.recipe_items (recipe_id, ingredient_id, quantity, note)
    values (v_new_id, (v_item ->> 'ingredient_id')::uuid, (v_item ->> 'quantity')::numeric, nullif(v_item ->> 'note', ''));
  end loop;

  perform public.write_audit('SAVE_RECIPE', 'recipes', v_new_id,
    case when v_old.id is null then null else jsonb_build_object('previous_recipe_id', v_old.id, 'version', v_old.version) end,
    jsonb_build_object('product_id', p_product_id, 'version', v_version, 'items', p_items));
  return v_new_id;
end $$;

-- ---------------------------------------------------------------------------
-- Cost views (security_invoker: the caller's RLS applies)
-- ---------------------------------------------------------------------------
create view public.recipe_item_costs with (security_invoker = true) as
select
  ri.id, ri.recipe_id, ri.ingredient_id, i.name_th as ingredient_name, i.unit, ri.quantity,
  i.avg_cost as unit_cost,
  round(ri.quantity * i.avg_cost, 4) as line_cost
from public.recipe_items ri
join public.ingredients i on i.id = ri.ingredient_id;

create view public.recipe_costs with (security_invoker = true) as
with totals as (
  select recipe_id, coalesce(sum(line_cost), 0) as recipe_cost, count(*) as ingredient_count
  from public.recipe_item_costs group by recipe_id
)
select
  r.id as recipe_id, r.product_id, p.name_th as product_name, r.name, r.version, r.is_active,
  r.yield_quantity, r.yield_unit, r.units_per_sale, p.price,
  public.net_of_vat(p.price) as net_price,
  coalesce(t.ingredient_count, 0) as ingredient_count,
  round(coalesce(t.recipe_cost, 0), 4) as recipe_cost,
  round(coalesce(t.recipe_cost, 0) / r.yield_quantity, 4) as cost_per_yield,
  round(coalesce(t.recipe_cost, 0) / r.yield_quantity * r.units_per_sale, 4) as cost_per_selling_unit,
  round(public.net_of_vat(p.price) - coalesce(t.recipe_cost, 0) / r.yield_quantity * r.units_per_sale, 4) as gross_profit,
  case when public.net_of_vat(p.price) > 0
    then round((public.net_of_vat(p.price) - coalesce(t.recipe_cost, 0) / r.yield_quantity * r.units_per_sale)
               / public.net_of_vat(p.price), 4)
  end as gross_margin
from public.recipes r
join public.products p on p.id = r.product_id
left join totals t on t.recipe_id = r.id;

-- Current unit cost of selling one product (used by POS cost estimates & menu profitability).
create view public.product_costs with (security_invoker = true) as
select
  p.id as product_id, p.name_th, p.category_id, p.price, p.inventory_mode, p.is_active,
  public.net_of_vat(p.price) as net_price,
  case p.inventory_mode
    when 'RECIPE' then rc.cost_per_selling_unit
    when 'FINISHED_GOOD' then coalesce(nullif(fg.avg_cost, 0), rc.cost_per_selling_unit)
    else 0
  end as unit_cost,
  rc.recipe_id,
  fg.id as finished_item_id,
  fg.stock_qty as finished_stock
from public.products p
left join public.recipe_costs rc on rc.product_id = p.id and rc.is_active
left join public.ingredients fg on fg.product_id = p.id;

grant select on public.recipe_item_costs, public.recipe_costs, public.product_costs to authenticated;
grant execute on function public.save_recipe(uuid, text, numeric, text, numeric, jsonb, text) to authenticated;
grant execute on function public.setting_numeric(text, numeric), public.setting_bool(text, boolean), public.net_of_vat(numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Product image storage (only on a real Supabase instance)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true)
    on conflict (id) do nothing;
    execute $p$create policy "product images readable" on storage.objects for select
      using (bucket_id = 'product-images')$p$;
    execute $p$create policy "managers upload product images" on storage.objects for insert to authenticated
      with check (bucket_id = 'product-images' and public.has_role('OWNER','MANAGER'))$p$;
    execute $p$create policy "managers update product images" on storage.objects for update to authenticated
      using (bucket_id = 'product-images' and public.has_role('OWNER','MANAGER'))$p$;
    execute $p$create policy "managers delete product images" on storage.objects for delete to authenticated
      using (bucket_id = 'product-images' and public.has_role('OWNER','MANAGER'))$p$;
  end if;
end $$;

-- =============================================================================
-- Phase 4: Inventory ledger engine
--
-- inventory_transactions is the single source of truth. The BEFORE INSERT trigger
-- below is the ONLY place stock_qty / avg_cost change (weighted average cost).
-- =============================================================================

create or replace function public.apply_inventory_transaction()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.ingredients;
  v_on_hand numeric;
  v_new_balance numeric;
begin
  -- Sign rules per transaction type
  if (new.transaction_type in ('PURCHASE', 'RETURN') and new.quantity <= 0)
     or (new.transaction_type in ('SALE', 'WASTE') and new.quantity >= 0) then
    raise exception 'VALIDATION: invalid quantity sign for %', new.transaction_type using errcode = 'P0001';
  end if;

  select * into v_item from public.ingredients where id = new.ingredient_id for update;
  if not found then
    raise exception 'NOT_FOUND: ingredient' using errcode = 'P0001';
  end if;

  v_new_balance := v_item.stock_qty + new.quantity;
  if v_new_balance < 0 and not v_item.allow_negative then
    raise exception 'INSUFFICIENT_STOCK: %', v_item.name_th
      using errcode = 'P0001',
            detail = format('%s: มี %s %s ต้องใช้ %s', v_item.name_th, trim_scale(v_item.stock_qty), v_item.unit, trim_scale(-new.quantity));
  end if;

  if new.quantity < 0 then
    -- Outbound: always valued at current weighted average cost.
    new.unit_cost := v_item.avg_cost;
  else
    -- Inbound: missing cost (e.g. a found-stock adjustment) is valued at current average.
    if coalesce(new.unit_cost, 0) = 0 and new.transaction_type in ('ADJUSTMENT', 'RETURN') then
      new.unit_cost := v_item.avg_cost;
    end if;
    -- Weighted average over the positive on-hand quantity.
    v_on_hand := greatest(v_item.stock_qty, 0);
    if v_on_hand + new.quantity > 0 then
      v_item.avg_cost := round((v_on_hand * v_item.avg_cost + new.quantity * coalesce(new.unit_cost, 0)) / (v_on_hand + new.quantity), 4);
    end if;
  end if;

  new.unit_cost := coalesce(new.unit_cost, 0);
  new.balance_after := v_new_balance;
  new.user_id := coalesce(new.user_id, auth.uid());

  update public.ingredients
     set stock_qty = v_new_balance, avg_cost = v_item.avg_cost
   where id = v_item.id;
  return new;
end $$;

create trigger inventory_transactions_apply before insert on public.inventory_transactions
  for each row execute function public.apply_inventory_transaction();

-- Internal helper used by every RPC that moves stock.
create or replace function public.post_inventory(
  p_ingredient_id uuid,
  p_type public.inventory_txn_type,
  p_quantity numeric,
  p_unit_cost numeric,
  p_reference_type text,
  p_reference_id uuid,
  p_note text default null
) returns public.inventory_transactions
language plpgsql security definer set search_path = public
as $$
declare v_row public.inventory_transactions;
begin
  if p_quantity is null or p_quantity = 0 then
    raise exception 'VALIDATION: quantity must not be zero' using errcode = 'P0001';
  end if;
  insert into public.inventory_transactions
    (ingredient_id, transaction_type, quantity, unit_cost, reference_type, reference_id, note, user_id)
  values (p_ingredient_id, p_type, round(p_quantity, 4), coalesce(p_unit_cost, 0), p_reference_type, p_reference_id, p_note, auth.uid())
  returning * into v_row;
  return v_row;
end $$;
revoke execute on function public.post_inventory(uuid, public.inventory_txn_type, numeric, numeric, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- People-facing stock RPCs
-- ---------------------------------------------------------------------------

-- Manual adjustment (opening stock, corrections). Positive delta may carry a unit cost.
create or replace function public.adjust_stock(
  p_ingredient_id uuid, p_delta numeric, p_unit_cost numeric default null, p_note text default null
) returns public.inventory_transactions
language plpgsql security definer set search_path = public
as $$
declare v_row public.inventory_transactions;
begin
  perform public.require_role('OWNER', 'MANAGER');
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'VALIDATION: a note is required for adjustments' using errcode = 'P0001';
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'VALIDATION: unit cost must be >= 0' using errcode = 'P0001';
  end if;
  v_row := public.post_inventory(p_ingredient_id, 'ADJUSTMENT', p_delta, case when p_delta > 0 then p_unit_cost end,
                                 'adjustment', null, p_note);
  perform public.write_audit('ADJUST_STOCK', 'ingredients', p_ingredient_id, null, to_jsonb(v_row));
  return v_row;
end $$;

-- Physical stock count: posts the difference as an ADJUSTMENT.
create or replace function public.record_stock_count(
  p_ingredient_id uuid, p_counted numeric, p_note text default null
) returns public.inventory_transactions
language plpgsql security definer set search_path = public
as $$
declare
  v_stock numeric;
  v_row public.inventory_transactions;
begin
  perform public.require_role('OWNER', 'MANAGER');
  if p_counted is null or p_counted < 0 then
    raise exception 'VALIDATION: counted quantity must be >= 0' using errcode = 'P0001';
  end if;
  select stock_qty into v_stock from public.ingredients where id = p_ingredient_id for update;
  if not found then raise exception 'NOT_FOUND: ingredient' using errcode = 'P0001'; end if;
  if p_counted = v_stock then
    return null; -- nothing to post
  end if;
  v_row := public.post_inventory(p_ingredient_id, 'ADJUSTMENT', p_counted - v_stock, null, 'stock_count', null,
                                 coalesce(nullif(trim(p_note), ''), 'นับสต็อก'));
  perform public.write_audit('STOCK_COUNT', 'ingredients', p_ingredient_id,
    jsonb_build_object('stock_qty', v_stock), jsonb_build_object('stock_qty', p_counted));
  return v_row;
end $$;

-- Waste (spoilage, spills, expired). Front-of-house may record it.
create or replace function public.record_waste(
  p_ingredient_id uuid, p_quantity numeric, p_reason text
) returns public.waste
language plpgsql security definer set search_path = public
as $$
declare
  v_txn public.inventory_transactions;
  v_waste public.waste;
begin
  perform public.require_role('OWNER', 'MANAGER', 'CASHIER');
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'VALIDATION: waste quantity must be > 0' using errcode = 'P0001';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'VALIDATION: a reason is required' using errcode = 'P0001';
  end if;
  insert into public.waste (ingredient_id, quantity, reason, created_by)
  values (p_ingredient_id, p_quantity, trim(p_reason), auth.uid())
  returning * into v_waste;
  v_txn := public.post_inventory(p_ingredient_id, 'WASTE', -p_quantity, null, 'waste', v_waste.id, trim(p_reason));
  update public.waste set unit_cost = v_txn.unit_cost, inventory_transaction_id = v_txn.id where id = v_waste.id
  returning * into v_waste;
  perform public.write_audit('RECORD_WASTE', 'waste', v_waste.id, null, to_jsonb(v_waste));
  return v_waste;
end $$;

-- ---------------------------------------------------------------------------
-- Integrity checks
-- ---------------------------------------------------------------------------
create view public.inventory_reconciliation with (security_invoker = true) as
select
  i.id as ingredient_id, i.name_th, i.unit, i.stock_qty,
  coalesce(sum(t.quantity), 0) as ledger_qty,
  i.stock_qty - coalesce(sum(t.quantity), 0) as difference
from public.ingredients i
left join public.inventory_transactions t on t.ingredient_id = i.id
group by i.id;

create or replace function public.check_inventory_integrity()
returns table (ingredient_id uuid, name_th text, stock_qty numeric, ledger_qty numeric, difference numeric)
language sql stable security definer set search_path = public
as $$
  select r.ingredient_id, r.name_th, r.stock_qty, r.ledger_qty, r.difference
  from public.inventory_reconciliation r
  where r.difference <> 0 and public.has_role('OWNER', 'MANAGER')
$$;

-- Stock valuation & low-stock view used by inventory screens and dashboards.
create view public.stock_levels with (security_invoker = true) as
select
  i.id, i.name_th, i.name_en, i.sku, i.unit, i.item_type, i.category_id, i.product_id,
  i.stock_qty, i.avg_cost, i.reorder_level, i.is_active,
  round(greatest(i.stock_qty, 0) * i.avg_cost, 2) as stock_value,
  (i.stock_qty <= i.reorder_level) as is_low
from public.ingredients i;

grant select on public.inventory_reconciliation, public.stock_levels to authenticated;
grant execute on function public.adjust_stock(uuid, numeric, numeric, text), public.record_stock_count(uuid, numeric, text),
  public.record_waste(uuid, numeric, text), public.check_inventory_integrity() to authenticated;

-- =============================================================================
-- Phase 5–6: POS orders, payments, automatic inventory deduction, COGS,
-- cancellation, refunds, kitchen status.
--
-- Flow inside create_order (ONE transaction):
--   order → order items → recipe lookup → ingredient usage → inventory SALE txns
--   → stock update (ledger trigger) → COGS → payments → cash drawer → points → audit
-- =============================================================================

alter table public.orders add column client_ref uuid unique;   -- idempotency key (offline queue retries)
alter table public.orders add column payment_summary jsonb not null default '{}'::jsonb;

-- Cash sessions are needed by POS; full management arrives in phase 9.
create or replace function public.current_cash_session_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.cash_sessions where status = 'OPEN' limit 1
$$;

-- Ingredient usage for selling p_quantity units of a product (one row per stock item).
create or replace function public.product_usage(p_product_id uuid, p_quantity numeric)
returns table (ingredient_id uuid, quantity numeric)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_mode public.inventory_mode;
  v_recipe public.recipes;
begin
  select inventory_mode into v_mode from public.products where id = p_product_id;
  if v_mode = 'NONE' then
    return;
  elsif v_mode = 'FINISHED_GOOD' then
    -- A sold unit may hold several produced units (e.g. a box of 4) — recipe.units_per_sale.
    return query
      select i.id, round(p_quantity * coalesce(
        (select r.units_per_sale from public.recipes r where r.product_id = p_product_id and r.is_active), 1), 4)
      from public.ingredients i where i.product_id = p_product_id;
    if not found then
      raise exception 'NOT_FOUND: finished goods item' using errcode = 'P0001';
    end if;
  else
    select * into v_recipe from public.recipes where product_id = p_product_id and is_active;
    if not found then
      raise exception 'NO_ACTIVE_RECIPE: %', (select name_th from public.products where id = p_product_id)
        using errcode = 'P0001', detail = (select name_th from public.products where id = p_product_id);
    end if;
    return query
      select ri.ingredient_id, round(ri.quantity / v_recipe.yield_quantity * v_recipe.units_per_sale * p_quantity, 4)
      from public.recipe_items ri where ri.recipe_id = v_recipe.id;
  end if;
end $$;
revoke execute on function public.product_usage(uuid, numeric) from public, anon, authenticated;

-- Pricing (shared by quote_order and create_order). Returns a jsonb breakdown.
-- p_payload: { items:[{product_id, quantity, note?}], customer_id?, promotion_id?, promo_code?,
--              manual_discount?, redeem_points? }
create or replace function public.price_order(p_payload jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_product public.products;
  v_qty integer;
  v_subtotal numeric := 0;
  v_promo public.promotions;
  v_promo_discount numeric := 0;
  v_manual numeric := coalesce((p_payload ->> 'manual_discount')::numeric, 0);
  v_redeem integer := coalesce((p_payload ->> 'redeem_points')::integer, 0);
  v_points_discount numeric := 0;
  v_customer public.customers;
  v_remaining numeric;
  v_vat numeric := 0;
  v_total numeric;
  v_rate numeric := public.setting_numeric('vat_rate', 7);
  v_bpp numeric := public.setting_numeric('baht_per_point', 25);
begin
  if jsonb_typeof(p_payload -> 'items') <> 'array' or jsonb_array_length(p_payload -> 'items') = 0 then
    raise exception 'VALIDATION: order has no items' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_payload -> 'items') > 200 then
    raise exception 'VALIDATION: too many items' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_payload -> 'items') loop
    v_qty := (v_item ->> 'quantity')::integer;
    if v_qty is null or v_qty <= 0 or v_qty > 999 then
      raise exception 'VALIDATION: invalid quantity' using errcode = 'P0001';
    end if;
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid and is_active;
    if not found then
      raise exception 'VALIDATION: product unavailable' using errcode = 'P0001';
    end if;
    v_items := v_items || jsonb_build_object(
      'product_id', v_product.id, 'product_name', v_product.name_th, 'quantity', v_qty,
      'unit_price', v_product.price, 'line_total', round(v_product.price * v_qty, 2),
      'note', nullif(trim(v_item ->> 'note'), ''));
    v_subtotal := v_subtotal + round(v_product.price * v_qty, 2);
  end loop;
  v_remaining := v_subtotal;

  if p_payload ->> 'customer_id' is not null then
    select * into v_customer from public.customers where id = (p_payload ->> 'customer_id')::uuid;
    if not found then raise exception 'NOT_FOUND: customer' using errcode = 'P0001'; end if;
  end if;

  -- Promotion
  if p_payload ->> 'promotion_id' is not null then
    select * into v_promo from public.promotions where id = (p_payload ->> 'promotion_id')::uuid;
    if not found then raise exception 'PROMOTION_INVALID: not found' using errcode = 'P0001'; end if;
  elsif nullif(trim(p_payload ->> 'promo_code'), '') is not null then
    select * into v_promo from public.promotions where code = upper(trim(p_payload ->> 'promo_code'));
    if not found then raise exception 'PROMOTION_INVALID: unknown code' using errcode = 'P0001'; end if;
  end if;
  if v_promo.id is not null then
    if not v_promo.is_active
       or (v_promo.starts_at is not null and now() < v_promo.starts_at)
       or (v_promo.ends_at is not null and now() > v_promo.ends_at) then
      raise exception 'PROMOTION_INVALID: not active' using errcode = 'P0001';
    end if;
    if v_promo.members_only and v_customer.id is null then
      raise exception 'PROMOTION_INVALID: members only' using errcode = 'P0001';
    end if;
    if v_subtotal < v_promo.min_subtotal then
      raise exception 'PROMOTION_INVALID: minimum subtotal %', v_promo.min_subtotal using errcode = 'P0001';
    end if;
    v_promo_discount := case v_promo.discount_type
      when 'PERCENT' then round(v_subtotal * v_promo.value / 100, 2) else v_promo.value end;
    if v_promo.max_discount is not null then v_promo_discount := least(v_promo_discount, v_promo.max_discount); end if;
    v_promo_discount := least(v_promo_discount, v_remaining);
    v_remaining := v_remaining - v_promo_discount;
  end if;

  -- Manual discount
  if v_manual < 0 or round(v_manual, 2) <> v_manual then
    raise exception 'VALIDATION: invalid manual discount' using errcode = 'P0001';
  end if;
  if v_manual > v_remaining then
    raise exception 'VALIDATION: discount exceeds amount due' using errcode = 'P0001';
  end if;
  v_remaining := v_remaining - v_manual;

  -- Points redemption
  if v_redeem < 0 then raise exception 'POINTS_INVALID: negative' using errcode = 'P0001'; end if;
  if v_redeem > 0 then
    if v_customer.id is null then raise exception 'POINTS_INVALID: customer required' using errcode = 'P0001'; end if;
    if v_redeem > v_customer.points_balance then raise exception 'POINTS_INVALID: insufficient points' using errcode = 'P0001'; end if;
    if v_redeem < public.setting_numeric('min_redeem_points', 0) then
      raise exception 'POINTS_INVALID: below minimum' using errcode = 'P0001';
    end if;
    v_points_discount := round(v_redeem * public.setting_numeric('point_value', 1), 2);
    if v_points_discount > v_remaining then raise exception 'POINTS_INVALID: exceeds amount due' using errcode = 'P0001'; end if;
    v_remaining := v_remaining - v_points_discount;
  end if;

  -- VAT
  v_total := v_remaining;
  if public.setting_bool('vat_enabled', false) and v_rate > 0 then
    if public.setting_bool('vat_inclusive', true) then
      v_vat := round(v_remaining * v_rate / (100 + v_rate), 2);
    else
      v_vat := round(v_remaining * v_rate / 100, 2);
      v_total := v_remaining + v_vat;
    end if;
  end if;

  return jsonb_build_object(
    'items', v_items,
    'subtotal', v_subtotal,
    'promotion_id', v_promo.id,
    'promotion_name', v_promo.name,
    'promotion_discount', v_promo_discount,
    'manual_discount', v_manual,
    'points_redeemed', v_redeem,
    'points_discount', v_points_discount,
    'vat_amount', v_vat,
    'total', v_total,
    'customer_id', v_customer.id,
    'points_earned', case when v_customer.id is not null and v_bpp > 0 then floor(v_total / v_bpp)::integer else 0 end
  );
end $$;
revoke execute on function public.price_order(jsonb) from public, anon, authenticated;

-- Read-only quote for the POS screen.
create or replace function public.quote_order(p_payload jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('OWNER', 'MANAGER', 'CASHIER');
  return public.price_order(p_payload);
end $$;

-- Customer loyalty ledger helper.
create or replace function public.post_points(
  p_customer_id uuid, p_change integer, p_reason public.points_reason, p_order_id uuid, p_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_balance integer;
begin
  if p_change = 0 then return; end if;
  update public.customers set points_balance = points_balance + p_change
   where id = p_customer_id
  returning points_balance into v_balance;
  if v_balance < 0 then
    raise exception 'POINTS_INVALID: balance would be negative' using errcode = 'P0001';
  end if;
  insert into public.customer_points (customer_id, change, balance_after, reason, order_id, note, user_id)
  values (p_customer_id, p_change, v_balance, p_reason, p_order_id, p_note, auth.uid());
end $$;
revoke execute on function public.post_points(uuid, integer, public.points_reason, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_order
-- p_payload: price_order payload + { client_ref?, order_type?, table_label?, note?,
--   payments: [{method, amount, tendered?, reference?}] }
-- ---------------------------------------------------------------------------
create or replace function public.create_order(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.app_role := public.current_app_role();
  v_existing uuid;
  v_session uuid;
  v_quote jsonb;
  v_total numeric;
  v_pay jsonb;
  v_paid numeric := 0;
  v_cash numeric := 0;
  v_change_total numeric := 0;
  v_method public.payment_method;
  v_amount numeric;
  v_tendered numeric;
  v_date date := public.bkk_date(now());
  v_queue integer;
  v_order_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_usage record;
  v_txn public.inventory_transactions;
  v_item_cogs numeric;
  v_cogs numeric := 0;
  v_customer uuid;
  v_order_type public.order_type := coalesce((p_payload ->> 'order_type')::public.order_type, 'TAKEAWAY');
  v_summary jsonb := '{}'::jsonb;
begin
  if v_role is null or v_role not in ('OWNER', 'MANAGER', 'CASHIER') then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  -- Idempotency: the same client_ref returns the already-created order.
  if p_payload ->> 'client_ref' is not null then
    select id into v_existing from public.orders where client_ref = (p_payload ->> 'client_ref')::uuid;
    if found then
      return public.order_json(v_existing) || jsonb_build_object('duplicate', true);
    end if;
  end if;

  v_session := public.current_cash_session_id();
  if v_session is null then
    raise exception 'NO_OPEN_SESSION' using errcode = 'P0001';
  end if;

  v_quote := public.price_order(p_payload);
  v_total := (v_quote ->> 'total')::numeric;
  v_customer := (v_quote ->> 'customer_id')::uuid;

  if v_role = 'CASHIER' and (v_quote ->> 'manual_discount')::numeric > public.setting_numeric('max_cashier_discount', 0) then
    raise exception 'DISCOUNT_LIMIT: manual discount above cashier limit' using errcode = 'P0001';
  end if;

  -- Payments must cover the total exactly (mixed payments allowed).
  if jsonb_typeof(coalesce(p_payload -> 'payments', '[]'::jsonb)) <> 'array' then
    raise exception 'VALIDATION: payments must be an array' using errcode = 'P0001';
  end if;
  for v_pay in select * from jsonb_array_elements(coalesce(p_payload -> 'payments', '[]'::jsonb)) loop
    v_method := (v_pay ->> 'method')::public.payment_method;
    v_amount := (v_pay ->> 'amount')::numeric;
    if v_amount is null or v_amount <= 0 or round(v_amount, 2) <> v_amount then
      raise exception 'PAYMENT_MISMATCH: invalid payment amount' using errcode = 'P0001';
    end if;
    v_paid := v_paid + v_amount;
    if v_method = 'CASH' then
      v_tendered := coalesce((v_pay ->> 'tendered')::numeric, v_amount);
      if v_tendered < v_amount then
        raise exception 'PAYMENT_MISMATCH: cash tendered is less than amount' using errcode = 'P0001';
      end if;
      v_cash := v_cash + v_amount;
      v_change_total := v_change_total + (v_tendered - v_amount);
    end if;
    v_summary := jsonb_set(v_summary, array[v_method::text], to_jsonb(coalesce((v_summary ->> v_method::text)::numeric, 0) + v_amount));
  end loop;
  if v_paid <> v_total then
    raise exception 'PAYMENT_MISMATCH: paid % but total is %', v_paid, v_total using errcode = 'P0001';
  end if;

  -- Order number / queue number per Bangkok business date (serialised).
  perform pg_advisory_xact_lock(hashtext('order_seq:' || v_date::text));
  select coalesce(max(queue_number), 0) + 1 into v_queue from public.orders where business_date = v_date;

  insert into public.orders (
    order_number, queue_number, business_date, order_type, table_label, customer_id, promotion_id, cash_session_id,
    subtotal, promotion_discount, manual_discount, points_redeemed, points_discount, vat_amount, total,
    points_earned, note, created_by, client_ref, payment_summary
  ) values (
    to_char(v_date, 'YYMMDD') || '-' || lpad(v_queue::text, 4, '0'), v_queue, v_date, v_order_type,
    nullif(trim(p_payload ->> 'table_label'), ''), v_customer, (v_quote ->> 'promotion_id')::uuid, v_session,
    (v_quote ->> 'subtotal')::numeric, (v_quote ->> 'promotion_discount')::numeric, (v_quote ->> 'manual_discount')::numeric,
    (v_quote ->> 'points_redeemed')::integer, (v_quote ->> 'points_discount')::numeric, (v_quote ->> 'vat_amount')::numeric,
    v_total, (v_quote ->> 'points_earned')::integer, left(nullif(trim(p_payload ->> 'note'), ''), 500), auth.uid(),
    (p_payload ->> 'client_ref')::uuid, v_summary
  ) returning id into v_order_id;

  -- Items → recipe usage → SALE transactions (per item) → COGS
  for v_item in select * from jsonb_array_elements(v_quote -> 'items') loop
    insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, line_total, note)
    values (v_order_id, (v_item ->> 'product_id')::uuid, v_item ->> 'product_name', (v_item ->> 'quantity')::integer,
            (v_item ->> 'unit_price')::numeric, (v_item ->> 'line_total')::numeric, left(v_item ->> 'note', 200))
    returning id into v_item_id;

    v_item_cogs := 0;
    for v_usage in select * from public.product_usage((v_item ->> 'product_id')::uuid, (v_item ->> 'quantity')::numeric) loop
      if v_usage.quantity > 0 then
        v_txn := public.post_inventory(v_usage.ingredient_id, 'SALE', -v_usage.quantity, null, 'order_item', v_item_id, null);
        v_item_cogs := v_item_cogs + v_usage.quantity * v_txn.unit_cost;
      end if;
    end loop;
    update public.order_items
       set cogs_total = round(v_item_cogs, 2), unit_cost = round(v_item_cogs / (v_item ->> 'quantity')::numeric, 4)
     where id = v_item_id;
    v_cogs := v_cogs + v_item_cogs;
  end loop;
  update public.orders set cogs_total = round(v_cogs, 2) where id = v_order_id;

  -- Payments and cash drawer
  for v_pay in select * from jsonb_array_elements(coalesce(p_payload -> 'payments', '[]'::jsonb)) loop
    v_method := (v_pay ->> 'method')::public.payment_method;
    v_amount := (v_pay ->> 'amount')::numeric;
    v_tendered := case when v_method = 'CASH' then coalesce((v_pay ->> 'tendered')::numeric, v_amount) end;
    insert into public.payments (order_id, method, amount, tendered, change_amount, reference)
    values (v_order_id, v_method, v_amount, v_tendered, coalesce(v_tendered - v_amount, 0), left(nullif(v_pay ->> 'reference', ''), 100));
  end loop;
  if v_cash > 0 then
    insert into public.cash_transactions (cash_session_id, transaction_type, amount, reference_type, reference_id, user_id)
    values (v_session, 'SALE', v_cash, 'order', v_order_id, auth.uid());
  end if;

  -- Loyalty
  if v_customer is not null then
    perform public.post_points(v_customer, -((v_quote ->> 'points_redeemed')::integer), 'REDEEM', v_order_id);
    perform public.post_points(v_customer, (v_quote ->> 'points_earned')::integer, 'EARN', v_order_id);
    update public.customers set total_spent = total_spent + v_total, visit_count = visit_count + 1 where id = v_customer;
  end if;

  perform public.write_audit('CREATE_ORDER', 'orders', v_order_id, null,
    jsonb_build_object('total', v_total, 'cogs', round(v_cogs, 2), 'payments', v_summary, 'change', v_change_total));
  return public.order_json(v_order_id);
end $$;

-- Full order document (header + items + payments) as jsonb.
create or replace function public.order_json(p_order_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select to_jsonb(o) || jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.payments p where p.order_id = o.id), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.refunds r where r.order_id = o.id), '[]'::jsonb),
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'points_balance', c.points_balance)
                 from public.customers c where c.id = o.customer_id),
    'cashier_name', (select e.display_name from public.employees e where e.user_id = o.created_by)
  )
  from public.orders o where o.id = p_order_id
$$;
revoke execute on function public.order_json(uuid) from public, anon, authenticated;

create or replace function public.get_order(p_order_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'permission denied' using errcode = '42501'; end if;
  return public.order_json(p_order_id);
end $$;

-- ---------------------------------------------------------------------------
-- cancel_order: full reversal (stock, cash, points, customer totals). Manager+.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
  v_txn record;
  v_session uuid;
  v_cash numeric;
begin
  perform public.require_role('OWNER', 'MANAGER');
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'VALIDATION: a reason is required' using errcode = 'P0001';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND: order' using errcode = 'P0001'; end if;
  if v_order.status <> 'COMPLETED' or v_order.refunded_total > 0 then
    raise exception 'INVALID_STATE: only completed, unrefunded orders can be cancelled' using errcode = 'P0001';
  end if;

  -- Return every unit of stock this order consumed, at its original cost.
  for v_txn in
    select t.ingredient_id, t.quantity, t.unit_cost from public.inventory_transactions t
    join public.order_items oi on oi.id = t.reference_id
    where t.reference_type = 'order_item' and t.transaction_type = 'SALE' and oi.order_id = p_order_id
  loop
    perform public.post_inventory(v_txn.ingredient_id, 'RETURN', -v_txn.quantity, v_txn.unit_cost, 'order_cancel', p_order_id, trim(p_reason));
  end loop;

  select coalesce(sum(amount), 0) into v_cash from public.payments where order_id = p_order_id and method = 'CASH';
  if v_cash > 0 then
    v_session := public.current_cash_session_id();
    if v_session is null then raise exception 'NO_OPEN_SESSION' using errcode = 'P0001'; end if;
    insert into public.cash_transactions (cash_session_id, transaction_type, amount, reference_type, reference_id, note, user_id)
    values (v_session, 'REFUND', -v_cash, 'order_cancel', p_order_id, trim(p_reason), auth.uid());
  end if;

  if v_order.customer_id is not null then
    perform public.post_points(v_order.customer_id,
      v_order.points_redeemed - least(v_order.points_earned,
        (select points_balance from public.customers where id = v_order.customer_id) + v_order.points_redeemed),
      'REVERSAL', p_order_id, 'cancel');
    update public.customers
       set total_spent = greatest(total_spent - v_order.total, 0), visit_count = greatest(visit_count - 1, 0)
     where id = v_order.customer_id;
  end if;

  update public.orders
     set status = 'CANCELLED', cancel_reason = trim(p_reason), cancelled_by = auth.uid(), cancelled_at = now()
   where id = p_order_id;
  perform public.write_audit('CANCEL_ORDER', 'orders', p_order_id,
    jsonb_build_object('status', v_order.status, 'total', v_order.total), jsonb_build_object('status', 'CANCELLED', 'reason', trim(p_reason)));
  return public.order_json(p_order_id);
end $$;

-- ---------------------------------------------------------------------------
-- refund_order: per-item refund. Refund value = item share of the paid total
-- (order-level discounts allocated proportionally). Optional restock.
-- p_items: [{order_item_id, quantity}]
-- ---------------------------------------------------------------------------
create or replace function public.refund_order(
  p_order_id uuid, p_items jsonb, p_reason text, p_method public.payment_method, p_restock boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
  v_item jsonb;
  v_oi public.order_items;
  v_qty integer;
  v_ratio numeric;
  v_amount numeric := 0;
  v_line numeric;
  v_cogs_reversed numeric := 0;
  v_txn record;
  v_session uuid;
  v_refund_id uuid;
  v_items_out jsonb := '[]'::jsonb;
  v_points integer;
  v_seq integer;
begin
  perform public.require_role('OWNER', 'MANAGER');
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'VALIDATION: a reason is required' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'VALIDATION: select items to refund' using errcode = 'P0001';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'NOT_FOUND: order' using errcode = 'P0001'; end if;
  if v_order.status not in ('COMPLETED', 'PARTIALLY_REFUNDED') then
    raise exception 'INVALID_STATE: order cannot be refunded' using errcode = 'P0001';
  end if;

  insert into public.refunds (refund_number, order_id, amount, method, reason, restock, created_by)
  values ('TMP-' || gen_random_uuid(), p_order_id, 0.01, p_method, trim(p_reason), p_restock, auth.uid())
  returning id into v_refund_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::integer;
    select * into v_oi from public.order_items where id = (v_item ->> 'order_item_id')::uuid and order_id = p_order_id for update;
    if not found then raise exception 'NOT_FOUND: order item' using errcode = 'P0001'; end if;
    if v_qty is null or v_qty <= 0 or v_qty > v_oi.quantity - v_oi.refunded_quantity then
      raise exception 'VALIDATION: refund quantity exceeds remaining quantity' using errcode = 'P0001';
    end if;
    v_ratio := v_qty::numeric / v_oi.quantity;
    v_line := case when v_order.subtotal > 0 then round(v_oi.line_total * v_ratio * v_order.total / v_order.subtotal, 2) else 0 end;
    v_amount := v_amount + v_line;
    update public.order_items set refunded_quantity = refunded_quantity + v_qty where id = v_oi.id;

    if p_restock then
      for v_txn in
        select t.ingredient_id, t.quantity, t.unit_cost from public.inventory_transactions t
        where t.reference_type = 'order_item' and t.reference_id = v_oi.id and t.transaction_type = 'SALE'
      loop
        perform public.post_inventory(v_txn.ingredient_id, 'RETURN', round(-v_txn.quantity * v_ratio, 4), v_txn.unit_cost,
                                      'refund', v_refund_id, trim(p_reason));
        v_cogs_reversed := v_cogs_reversed + round(-v_txn.quantity * v_ratio, 4) * v_txn.unit_cost;
      end loop;
    end if;
    v_items_out := v_items_out || jsonb_build_object('order_item_id', v_oi.id, 'product_name', v_oi.product_name, 'quantity', v_qty, 'amount', v_line);
  end loop;

  v_amount := least(v_amount, v_order.total - v_order.refunded_total);
  if v_amount <= 0 then
    raise exception 'VALIDATION: nothing to refund' using errcode = 'P0001';
  end if;

  if p_method = 'CASH' then
    v_session := public.current_cash_session_id();
    if v_session is null then raise exception 'NO_OPEN_SESSION' using errcode = 'P0001'; end if;
    insert into public.cash_transactions (cash_session_id, transaction_type, amount, reference_type, reference_id, note, user_id)
    values (v_session, 'REFUND', -v_amount, 'refund', v_refund_id, trim(p_reason), auth.uid());
  end if;

  perform pg_advisory_xact_lock(hashtext('refund_seq'));
  select count(*) + 1 into v_seq from public.refunds where refund_number not like 'TMP-%';
  update public.refunds
     set refund_number = 'RF' || to_char(public.bkk_date(now()), 'YYMMDD') || '-' || lpad(v_seq::text, 4, '0'),
         amount = v_amount, items = v_items_out, cogs_reversed = round(v_cogs_reversed, 2), cash_session_id = v_session
   where id = v_refund_id;

  update public.orders
     set refunded_total = refunded_total + v_amount,
         status = case when refunded_total + v_amount >= total then 'REFUNDED'::public.order_status
                       else 'PARTIALLY_REFUNDED'::public.order_status end
   where id = p_order_id;

  if v_order.customer_id is not null then
    v_points := least(
      floor(v_amount / nullif(public.setting_numeric('baht_per_point', 25), 0))::integer,
      v_order.points_earned,
      (select points_balance from public.customers where id = v_order.customer_id));
    if coalesce(v_points, 0) > 0 then
      perform public.post_points(v_order.customer_id, -v_points, 'REVERSAL', p_order_id, 'refund');
    end if;
    update public.customers set total_spent = greatest(total_spent - v_amount, 0) where id = v_order.customer_id;
  end if;

  perform public.write_audit('REFUND_ORDER', 'refunds', v_refund_id, null,
    jsonb_build_object('order_id', p_order_id, 'amount', v_amount, 'method', p_method, 'restock', p_restock, 'items', v_items_out));
  return public.order_json(p_order_id);
end $$;

-- ---------------------------------------------------------------------------
-- Kitchen display
-- ---------------------------------------------------------------------------
create or replace function public.set_kitchen_status(p_order_id uuid, p_status public.kitchen_status)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff() then raise exception 'permission denied' using errcode = '42501'; end if;
  update public.orders set kitchen_status = p_status where id = p_order_id and status <> 'CANCELLED';
  if not found then raise exception 'NOT_FOUND: order' using errcode = 'P0001'; end if;
end $$;

-- Orders the kitchen still has to work on (today and yesterday, Bangkok time).
create view public.kitchen_queue with (security_invoker = true) as
select o.id, o.order_number, o.queue_number, o.order_type, o.table_label, o.kitchen_status, o.note, o.created_at,
  coalesce((select jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity, 'note', i.note) order by i.id)
            from public.order_items i where i.order_id = o.id), '[]'::jsonb) as items
from public.orders o
where o.status <> 'CANCELLED' and o.kitchen_status in ('PENDING', 'PREPARING', 'READY')
  and o.business_date >= public.bkk_date(now()) - 1;

-- How many units of each product can be sold from current stock (null = not tracked).
create view public.product_availability with (security_invoker = true) as
select p.id as product_id,
  case p.inventory_mode
    when 'NONE' then null
    when 'FINISHED_GOOD' then (
      select floor(greatest(i.stock_qty, 0) / coalesce(
        (select r.units_per_sale from public.recipes r where r.product_id = p.id and r.is_active), 1))
      from public.ingredients i where i.product_id = p.id)
    else (
      select floor(min(greatest(i.stock_qty, 0) / (ri.quantity / r.yield_quantity * r.units_per_sale)))
      from public.recipes r
      join public.recipe_items ri on ri.recipe_id = r.id
      join public.ingredients i on i.id = ri.ingredient_id
      where r.product_id = p.id and r.is_active and not i.allow_negative
    )
  end::integer as available
from public.products p
where p.is_active;

grant select on public.kitchen_queue, public.product_availability to authenticated;
grant execute on function public.quote_order(jsonb), public.create_order(jsonb), public.get_order(uuid),
  public.cancel_order(uuid, text), public.refund_order(uuid, jsonb, text, public.payment_method, boolean),
  public.set_kitchen_status(uuid, public.kitchen_status), public.current_cash_session_id() to authenticated;

-- Realtime for the kitchen display (Supabase only).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

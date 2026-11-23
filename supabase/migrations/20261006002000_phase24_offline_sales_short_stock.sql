-- Phase 24: offline sales are recorded even when stock is short.
-- A sale made while the device was offline already happened: the customer has the goods and the
-- money is in the drawer. Rejecting it for INSUFFICIENT_STOCK when it syncs would lose the sale
-- from the books. create_order marks such orders ('offline': true) for this transaction only, and
-- the stock trigger then lets their SALE movements take stock below zero. Online sales still stop
-- at zero stock unless the item allows negative stock.

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
  -- A sale that already happened offline (the goods are gone, the money is in the drawer) is recorded
  -- even when the system's stock is short; the stock goes negative and shows up for counting.
  if v_new_balance < 0 and not v_item.allow_negative
     and not (new.transaction_type = 'SALE' and coalesce(current_setting('custard.offline_sale', true), '') = 'on') then
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
  -- Orders queued offline carry sold_at (when the sale happened); they belong to that business
  -- date. Only the last 3 days are accepted, and never the future. Cash still goes to the drawer
  -- session that is open now: the money is in today's drawer.
  v_sold_at timestamptz := least(greatest(coalesce(nullif(p_payload ->> 'sold_at', '')::timestamptz, now()), now() - interval '3 days'), now());
  v_date date := public.bkk_date(v_sold_at);
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

  -- Sent from the offline queue: the sale already happened, so short stock must not reject it.
  if coalesce((p_payload ->> 'offline')::boolean, false) then
    perform set_config('custard.offline_sale', 'on', true);
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

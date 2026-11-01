-- Phase 21: fixes from the full code review.
--  * create_order: an offline order is booked on the business date it was sold (payload sold_at)
--  * refund_order: refunding the last items refunds exactly the remainder (no 0.01 left over)
--  * cash_transactions can only be added to an OPEN drawer session (closing and selling at the
--    same moment can no longer put cash into a closed session)
--  * a journal entry can be reversed only once (double taps cannot reverse twice)

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

  -- Per-line shares are rounded one by one; when this refund returns the last remaining items,
  -- refund exactly what is left so the order always ends fully REFUNDED.
  if not exists (select 1 from public.order_items where order_id = p_order_id and refunded_quantity < quantity) then
    v_amount := v_order.total - v_order.refunded_total;
  end if;
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

create or replace function public.cash_transaction_requires_open_session()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Waits for a concurrent close (which locks the session row) and then sees its final status.
  perform 1 from public.cash_sessions where id = new.cash_session_id and status = 'OPEN' for share;
  if not found then
    raise exception 'NO_OPEN_SESSION: the drawer session is closed' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function public.cash_transaction_requires_open_session() from public, anon, authenticated;

create trigger cash_transactions_open_session before insert on public.cash_transactions
  for each row execute function public.cash_transaction_requires_open_session();

create unique index journal_entries_reverses_once on public.journal_entries (reverses) where reverses is not null;

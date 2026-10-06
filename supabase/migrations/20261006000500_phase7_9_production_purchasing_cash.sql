-- =============================================================================
-- Phase 7–9: Batch production, purchasing, expenses, cash sessions
-- =============================================================================

-- Sequential document numbers per Bangkok business day: PREFIX + YYMMDD + '-' + NNNN
create or replace function public.next_document_number(p_prefix text, p_table regclass, p_column text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_stem text := p_prefix || to_char(public.bkk_date(now()), 'YYMMDD') || '-';
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtext('docno:' || p_prefix));
  execute format('select coalesce(max(substring(%I from %s)::integer), 0) + 1 from %s where %I like $1',
                 p_column, length(v_stem) + 1, p_table, p_column)
    into v_next using v_stem || '%';
  return v_stem || lpad(v_next::text, 4, '0');
end $$;
revoke execute on function public.next_document_number(text, regclass, text) from public, anon, authenticated;

-- =============================================================================
-- Production
-- =============================================================================

create or replace function public.create_production(p_product_id uuid, p_batches numeric, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_product public.products;
  v_recipe public.recipes;
  v_finished uuid;
  v_id uuid;
begin
  perform public.require_role('OWNER', 'MANAGER');
  if p_batches is null or p_batches <= 0 or p_batches > 10000 then
    raise exception 'VALIDATION: batches must be > 0' using errcode = 'P0001';
  end if;
  select * into v_product from public.products where id = p_product_id;
  if not found then raise exception 'NOT_FOUND: product' using errcode = 'P0001'; end if;
  if v_product.inventory_mode <> 'FINISHED_GOOD' then
    raise exception 'VALIDATION: only finished-good products are produced in batches' using errcode = 'P0001';
  end if;
  select * into v_recipe from public.recipes where product_id = p_product_id and is_active;
  if not found then raise exception 'NO_ACTIVE_RECIPE: %', v_product.name_th using errcode = 'P0001'; end if;
  select id into v_finished from public.ingredients where product_id = p_product_id;

  insert into public.production (production_number, recipe_id, product_id, finished_item_id, batches, yield_per_batch,
                                 planned_output, note, created_by)
  values (public.next_document_number('PD', 'public.production', 'production_number'), v_recipe.id, p_product_id, v_finished,
          p_batches, v_recipe.yield_quantity, round(p_batches * v_recipe.yield_quantity, 4), nullif(trim(p_note), ''), auth.uid())
  returning id into v_id;

  insert into public.production_items (production_id, ingredient_id, required_quantity)
  select v_id, ri.ingredient_id, round(ri.quantity * p_batches, 4)
  from public.recipe_items ri where ri.recipe_id = v_recipe.id;

  return v_id;
end $$;

-- Ingredient availability for a planned production (for the UI before completing).
create or replace function public.production_requirements(p_production_id uuid)
returns table (ingredient_id uuid, name_th text, unit text, required_quantity numeric, stock_qty numeric, shortage numeric, unit_cost numeric)
language sql stable security definer set search_path = public
as $$
  select pi.ingredient_id, i.name_th, i.unit, pi.required_quantity, i.stock_qty,
         greatest(pi.required_quantity - i.stock_qty, 0) as shortage, i.avg_cost
  from public.production_items pi
  join public.ingredients i on i.id = pi.ingredient_id
  where pi.production_id = p_production_id and public.has_role('OWNER', 'MANAGER')
  order by i.name_th
$$;

create or replace function public.complete_production(p_production_id uuid, p_actual_output numeric default null)
returns public.production
language plpgsql security definer set search_path = public
as $$
declare
  v_prod public.production;
  v_item record;
  v_txn public.inventory_transactions;
  v_total numeric := 0;
  v_output numeric;
  v_shortages text;
begin
  perform public.require_role('OWNER', 'MANAGER');
  select * into v_prod from public.production where id = p_production_id for update;
  if not found then raise exception 'NOT_FOUND: production' using errcode = 'P0001'; end if;
  if v_prod.status <> 'PLANNED' then
    raise exception 'INVALID_STATE: production is %', v_prod.status using errcode = 'P0001';
  end if;
  v_output := coalesce(p_actual_output, v_prod.planned_output);
  if v_output <= 0 then raise exception 'VALIDATION: output must be > 0' using errcode = 'P0001'; end if;

  -- Lock every ingredient, then validate ALL of them so the user sees every shortage at once.
  perform 1 from public.ingredients i join public.production_items pi on pi.ingredient_id = i.id
   where pi.production_id = p_production_id order by i.id for update of i;
  select string_agg(format('%s: มี %s ต้องใช้ %s %s', i.name_th, trim_scale(i.stock_qty), trim_scale(pi.required_quantity), i.unit), ', ')
    into v_shortages
  from public.production_items pi
  join public.ingredients i on i.id = pi.ingredient_id
  where pi.production_id = p_production_id and not i.allow_negative and i.stock_qty < pi.required_quantity;
  if v_shortages is not null then
    raise exception 'INSUFFICIENT_STOCK: production' using errcode = 'P0001', detail = v_shortages;
  end if;

  -- Raw materials out
  for v_item in select * from public.production_items where production_id = p_production_id loop
    v_txn := public.post_inventory(v_item.ingredient_id, 'PRODUCTION', -v_item.required_quantity, null,
                                   'production', p_production_id, v_prod.production_number);
    update public.production_items
       set unit_cost = v_txn.unit_cost, total_cost = round(v_item.required_quantity * v_txn.unit_cost, 2)
     where id = v_item.id;
    v_total := v_total + v_item.required_quantity * v_txn.unit_cost;
  end loop;

  -- Finished goods in, valued at actual batch cost per unit produced
  perform public.post_inventory(v_prod.finished_item_id, 'PRODUCTION', v_output, round(v_total / v_output, 4),
                                'production', p_production_id, v_prod.production_number);

  update public.production
     set status = 'COMPLETED', actual_output = v_output, total_cost = round(v_total, 2), unit_cost = round(v_total / v_output, 4),
         completed_by = auth.uid(), completed_at = now()
   where id = p_production_id
  returning * into v_prod;
  perform public.write_audit('COMPLETE_PRODUCTION', 'production', p_production_id, null,
    jsonb_build_object('output', v_output, 'total_cost', round(v_total, 2)));
  return v_prod;
end $$;

create or replace function public.cancel_production(p_production_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('OWNER', 'MANAGER');
  update public.production set status = 'CANCELLED' where id = p_production_id and status = 'PLANNED';
  if not found then raise exception 'INVALID_STATE: only planned production can be cancelled' using errcode = 'P0001'; end if;
end $$;

-- =============================================================================
-- Purchasing
-- =============================================================================

-- Create or replace a DRAFT purchase order. p_items: [{ingredient_id, quantity, unit_cost}]
create or replace function public.save_purchase_order(
  p_id uuid, p_supplier_id uuid, p_items jsonb, p_expected_date date default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid := p_id;
  v_status public.purchase_status;
  v_item jsonb;
begin
  perform public.require_role('OWNER', 'MANAGER');
  if not exists (select 1 from public.suppliers where id = p_supplier_id and is_active) then
    raise exception 'VALIDATION: supplier unavailable' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'VALIDATION: purchase order needs items' using errcode = 'P0001';
  end if;

  if v_id is null then
    insert into public.purchase_orders (po_number, supplier_id, expected_date, note, created_by)
    values (public.next_document_number('PO', 'public.purchase_orders', 'po_number'), p_supplier_id, p_expected_date,
            nullif(trim(p_note), ''), auth.uid())
    returning id into v_id;
  else
    select status into v_status from public.purchase_orders where id = v_id for update;
    if not found then raise exception 'NOT_FOUND: purchase order' using errcode = 'P0001'; end if;
    if v_status <> 'DRAFT' then raise exception 'INVALID_STATE: only drafts can be edited' using errcode = 'P0001'; end if;
    update public.purchase_orders set supplier_id = p_supplier_id, expected_date = p_expected_date, note = nullif(trim(p_note), '')
     where id = v_id;
    delete from public.purchase_items where purchase_order_id = v_id;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if exists (select 1 from public.ingredients where id = (v_item ->> 'ingredient_id')::uuid and item_type <> 'RAW') then
      raise exception 'VALIDATION: only raw materials can be purchased' using errcode = 'P0001';
    end if;
    insert into public.purchase_items (purchase_order_id, ingredient_id, quantity, unit_cost)
    values (v_id, (v_item ->> 'ingredient_id')::uuid, (v_item ->> 'quantity')::numeric, (v_item ->> 'unit_cost')::numeric);
  end loop;
  update public.purchase_orders
     set subtotal = (select coalesce(sum(line_total), 0) from public.purchase_items where purchase_order_id = v_id)
   where id = v_id;
  return v_id;
end $$;

create or replace function public.set_purchase_order_status(p_id uuid, p_status public.purchase_status)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_current public.purchase_status;
begin
  perform public.require_role('OWNER', 'MANAGER');
  select status into v_current from public.purchase_orders where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: purchase order' using errcode = 'P0001'; end if;
  if not ((v_current = 'DRAFT' and p_status in ('ORDERED', 'CANCELLED'))
       or (v_current = 'ORDERED' and p_status = 'CANCELLED'
           and not exists (select 1 from public.purchase_items where purchase_order_id = p_id and received_quantity > 0))) then
    raise exception 'INVALID_STATE: % → % not allowed', v_current, p_status using errcode = 'P0001';
  end if;
  update public.purchase_orders set status = p_status where id = p_id;
end $$;

-- Receive goods (full or partial). p_items: [{purchase_item_id, quantity, unit_cost?}]
create or replace function public.receive_purchase_order(
  p_id uuid, p_items jsonb, p_paid_from_drawer boolean default false
) returns public.purchase_orders
language plpgsql security definer set search_path = public
as $$
declare
  v_po public.purchase_orders;
  v_item jsonb;
  v_line public.purchase_items;
  v_qty numeric;
  v_cost numeric;
  v_received_value numeric := 0;
  v_session uuid;
begin
  perform public.require_role('OWNER', 'MANAGER');
  select * into v_po from public.purchase_orders where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: purchase order' using errcode = 'P0001'; end if;
  if v_po.status not in ('DRAFT', 'ORDERED') then
    raise exception 'INVALID_STATE: purchase order is %', v_po.status using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::numeric;
    if v_qty is null or v_qty = 0 then continue; end if;
    select * into v_line from public.purchase_items where id = (v_item ->> 'purchase_item_id')::uuid and purchase_order_id = p_id for update;
    if not found then raise exception 'NOT_FOUND: purchase item' using errcode = 'P0001'; end if;
    if v_qty < 0 or v_line.received_quantity + v_qty > v_line.quantity then
      raise exception 'VALIDATION: received quantity exceeds ordered quantity' using errcode = 'P0001';
    end if;
    v_cost := coalesce((v_item ->> 'unit_cost')::numeric, v_line.unit_cost);
    if v_cost < 0 then raise exception 'VALIDATION: unit cost must be >= 0' using errcode = 'P0001'; end if;
    perform public.post_inventory(v_line.ingredient_id, 'PURCHASE', v_qty, v_cost, 'purchase_order', p_id, v_po.po_number);
    update public.purchase_items set received_quantity = received_quantity + v_qty, unit_cost = v_cost where id = v_line.id;
    v_received_value := v_received_value + round(v_qty * v_cost, 2);
  end loop;
  if v_received_value = 0 then raise exception 'VALIDATION: nothing received' using errcode = 'P0001'; end if;

  if p_paid_from_drawer then
    v_session := public.current_cash_session_id();
    if v_session is null then raise exception 'NO_OPEN_SESSION' using errcode = 'P0001'; end if;
    insert into public.cash_transactions (cash_session_id, transaction_type, amount, reference_type, reference_id, note, user_id)
    values (v_session, 'WITHDRAWAL', -v_received_value, 'purchase_order', p_id, v_po.po_number, auth.uid());
  end if;

  update public.purchase_orders
     set status = case when not exists (select 1 from public.purchase_items where purchase_order_id = p_id and received_quantity < quantity)
                       then 'RECEIVED'::public.purchase_status else 'ORDERED'::public.purchase_status end,
         received_at = now(),
         subtotal = (select coalesce(sum(line_total), 0) from public.purchase_items where purchase_order_id = p_id)
   where id = p_id
  returning * into v_po;
  perform public.write_audit('RECEIVE_PURCHASE', 'purchase_orders', p_id, null,
    jsonb_build_object('items', p_items, 'value', v_received_value, 'paid_from_drawer', p_paid_from_drawer));
  return v_po;
end $$;

-- =============================================================================
-- Cash sessions
-- =============================================================================

create or replace function public.open_cash_session(p_opening_cash numeric, p_note text default null)
returns public.cash_sessions
language plpgsql security definer set search_path = public
as $$
declare v_session public.cash_sessions;
begin
  perform public.require_role('OWNER', 'MANAGER', 'CASHIER');
  if p_opening_cash is null or p_opening_cash < 0 then
    raise exception 'VALIDATION: opening cash must be >= 0' using errcode = 'P0001';
  end if;
  if public.current_cash_session_id() is not null then
    raise exception 'SESSION_ALREADY_OPEN' using errcode = 'P0001';
  end if;
  insert into public.cash_sessions (opening_cash, opened_by, note) values (p_opening_cash, auth.uid(), nullif(trim(p_note), ''))
  returning * into v_session;
  insert into public.cash_transactions (cash_session_id, transaction_type, amount, note, user_id)
  values (v_session.id, 'OPENING', p_opening_cash, 'เงินทอนตั้งต้น', auth.uid());
  return v_session;
end $$;

-- Manual drawer movement: DEPOSIT (+) or WITHDRAWAL (-, e.g. bank drop).
create or replace function public.cash_movement(p_type public.cash_txn_type, p_amount numeric, p_note text)
returns public.cash_transactions
language plpgsql security definer set search_path = public
as $$
declare
  v_session uuid := public.current_cash_session_id();
  v_row public.cash_transactions;
begin
  perform public.require_role('OWNER', 'MANAGER', 'CASHIER');
  if v_session is null then raise exception 'NO_OPEN_SESSION' using errcode = 'P0001'; end if;
  if p_type not in ('DEPOSIT', 'WITHDRAWAL') then raise exception 'VALIDATION: use DEPOSIT or WITHDRAWAL' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'VALIDATION: amount must be > 0' using errcode = 'P0001'; end if;
  if p_note is null or length(trim(p_note)) = 0 then raise exception 'VALIDATION: a note is required' using errcode = 'P0001'; end if;
  insert into public.cash_transactions (cash_session_id, transaction_type, amount, reference_type, note, user_id)
  values (v_session, p_type, case when p_type = 'WITHDRAWAL' then -p_amount else p_amount end, 'manual', trim(p_note), auth.uid())
  returning * into v_row;
  perform public.write_audit('CASH_' || p_type::text, 'cash_sessions', v_session, null, to_jsonb(v_row));
  return v_row;
end $$;

create or replace function public.employee_name(p_user_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select display_name from public.employees where user_id = p_user_id and public.is_staff()
$$;
grant execute on function public.employee_name(uuid) to authenticated;

create view public.cash_session_summary with (security_invoker = true) as
select
  s.id, s.status, s.opened_at, s.closed_at, s.opening_cash, s.actual_cash, s.variance, s.opened_by, s.closed_by, s.note,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'SALE'), 0) as cash_sales,
  coalesce(-sum(t.amount) filter (where t.transaction_type = 'REFUND'), 0) as cash_refunds,
  coalesce(-sum(t.amount) filter (where t.transaction_type = 'EXPENSE'), 0) as cash_expenses,
  coalesce(-sum(t.amount) filter (where t.transaction_type = 'WITHDRAWAL'), 0) as withdrawals,
  coalesce(sum(t.amount) filter (where t.transaction_type = 'DEPOSIT'), 0) as deposits,
  coalesce(sum(t.amount), 0) as expected_cash,
  (select coalesce(sum(o.total), 0) from public.orders o where o.cash_session_id = s.id and o.status <> 'CANCELLED') as total_sales,
  (select count(*) from public.orders o where o.cash_session_id = s.id and o.status <> 'CANCELLED') as order_count,
  public.employee_name(s.opened_by) as opened_by_name,
  public.employee_name(s.closed_by) as closed_by_name
from public.cash_sessions s
left join public.cash_transactions t on t.cash_session_id = s.id
group by s.id;

create or replace function public.close_cash_session(p_actual_cash numeric, p_note text default null)
returns public.cash_sessions
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid := public.current_cash_session_id();
  v_expected numeric;
  v_session public.cash_sessions;
begin
  perform public.require_role('OWNER', 'MANAGER', 'CASHIER');
  if v_id is null then raise exception 'NO_OPEN_SESSION' using errcode = 'P0001'; end if;
  if p_actual_cash is null or p_actual_cash < 0 then
    raise exception 'VALIDATION: counted cash must be >= 0' using errcode = 'P0001';
  end if;
  perform 1 from public.cash_sessions where id = v_id for update;
  select coalesce(sum(amount), 0) into v_expected from public.cash_transactions where cash_session_id = v_id;
  update public.cash_sessions
     set status = 'CLOSED', expected_cash = v_expected, actual_cash = p_actual_cash, variance = p_actual_cash - v_expected,
         closed_by = auth.uid(), closed_at = now(), note = coalesce(nullif(trim(p_note), ''), note)
   where id = v_id
  returning * into v_session;
  return v_session;
end $$;

-- =============================================================================
-- Expenses
-- =============================================================================
alter table public.expenses add column voided_at timestamptz;
alter table public.expenses add column void_reason text;

create or replace function public.record_expense(
  p_expense_date date, p_category text, p_description text, p_amount numeric,
  p_payment_method public.payment_method default 'CASH', p_from_drawer boolean default false,
  p_supplier_id uuid default null, p_receipt_path text default null
) returns public.expenses
language plpgsql security definer set search_path = public
as $$
declare
  v_session uuid;
  v_row public.expenses;
begin
  perform public.require_role('OWNER', 'MANAGER');
  if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount then
    raise exception 'VALIDATION: amount must be > 0 with at most 2 decimals' using errcode = 'P0001';
  end if;
  if p_from_drawer then
    if p_payment_method <> 'CASH' then raise exception 'VALIDATION: drawer payments must be cash' using errcode = 'P0001'; end if;
    v_session := public.current_cash_session_id();
    if v_session is null then raise exception 'NO_OPEN_SESSION' using errcode = 'P0001'; end if;
  end if;
  insert into public.expenses (expense_date, category, description, amount, payment_method, supplier_id, cash_session_id, receipt_path, created_by)
  values (coalesce(p_expense_date, public.bkk_date(now())), trim(p_category), trim(p_description), p_amount, p_payment_method,
          p_supplier_id, v_session, p_receipt_path, auth.uid())
  returning * into v_row;
  if v_session is not null then
    insert into public.cash_transactions (cash_session_id, transaction_type, amount, reference_type, reference_id, note, user_id)
    values (v_session, 'EXPENSE', -p_amount, 'expense', v_row.id, trim(p_description), auth.uid());
  end if;
  return v_row;
end $$;

create or replace function public.void_expense(p_id uuid, p_reason text)
returns public.expenses
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.expenses;
  v_session uuid;
begin
  perform public.require_role('OWNER');
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'VALIDATION: a reason is required' using errcode = 'P0001'; end if;
  select * into v_row from public.expenses where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: expense' using errcode = 'P0001'; end if;
  if v_row.voided_at is not null then raise exception 'INVALID_STATE: already voided' using errcode = 'P0001'; end if;
  if v_row.cash_session_id is not null then
    v_session := public.current_cash_session_id();
    if v_session is null then raise exception 'NO_OPEN_SESSION' using errcode = 'P0001'; end if;
    insert into public.cash_transactions (cash_session_id, transaction_type, amount, reference_type, reference_id, note, user_id)
    values (v_session, 'DEPOSIT', v_row.amount, 'expense_void', v_row.id, trim(p_reason), auth.uid());
  end if;
  update public.expenses set voided_at = now(), void_reason = trim(p_reason) where id = p_id returning * into v_row;
  return v_row;
end $$;

-- Receipt images for expenses (Supabase only)
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('expense-receipts', 'expense-receipts', false)
    on conflict (id) do nothing;
    execute $p$create policy "managers read expense receipts" on storage.objects for select to authenticated
      using (bucket_id = 'expense-receipts' and public.has_role('OWNER','MANAGER'))$p$;
    execute $p$create policy "managers upload expense receipts" on storage.objects for insert to authenticated
      with check (bucket_id = 'expense-receipts' and public.has_role('OWNER','MANAGER'))$p$;
  end if;
end $$;

grant select on public.cash_session_summary to authenticated;
grant execute on function
  public.create_production(uuid, numeric, text), public.production_requirements(uuid), public.complete_production(uuid, numeric),
  public.cancel_production(uuid), public.save_purchase_order(uuid, uuid, jsonb, date, text),
  public.set_purchase_order_status(uuid, public.purchase_status), public.receive_purchase_order(uuid, jsonb, boolean),
  public.open_cash_session(numeric, text), public.cash_movement(public.cash_txn_type, numeric, text),
  public.close_cash_session(numeric, text),
  public.record_expense(date, text, text, numeric, public.payment_method, boolean, uuid, text), public.void_expense(uuid, text)
to authenticated;

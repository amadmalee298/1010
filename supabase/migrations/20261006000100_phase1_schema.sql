-- =============================================================================
-- Phase 1: Core schema, helpers, audit logging, Row Level Security
-- Custard POS — PostgreSQL / Supabase
--
-- Conventions
--   * UUID primary keys (gen_random_uuid()).
--   * All timestamps are timestamptz (stored UTC). Display in Asia/Bangkok.
--   * Money: numeric(12,2) THB. Quantities: numeric(14,4) in the item's base unit.
--   * Stock is NEVER updated directly: insert into inventory_transactions and the
--     ledger trigger (phase 4 migration) applies it.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('OWNER', 'MANAGER', 'CASHIER', 'KITCHEN');
create type public.item_type as enum ('RAW', 'FINISHED');
create type public.inventory_mode as enum ('RECIPE', 'FINISHED_GOOD', 'NONE');
create type public.inventory_txn_type as enum ('PURCHASE', 'SALE', 'PRODUCTION', 'WASTE', 'ADJUSTMENT', 'RETURN');
create type public.order_status as enum ('COMPLETED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');
create type public.order_type as enum ('DINE_IN', 'TAKEAWAY', 'DELIVERY');
create type public.kitchen_status as enum ('PENDING', 'PREPARING', 'READY', 'SERVED');
create type public.payment_method as enum ('CASH', 'QR', 'TRANSFER', 'CARD');
create type public.discount_type as enum ('PERCENT', 'FIXED');
create type public.production_status as enum ('PLANNED', 'COMPLETED', 'CANCELLED');
create type public.purchase_status as enum ('DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED');
create type public.cash_session_status as enum ('OPEN', 'CLOSED');
create type public.cash_txn_type as enum ('OPENING', 'SALE', 'REFUND', 'EXPENSE', 'WITHDRAWAL', 'DEPOSIT');
create type public.points_reason as enum ('EARN', 'REDEEM', 'ADJUST', 'REVERSAL');

-- ---------------------------------------------------------------------------
-- People & access
-- ---------------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  code public.app_role not null unique,
  name_th text not null,
  name_en text not null,
  created_at timestamptz not null default now()
);

-- Mirror of auth.users so app tables can reference users without touching auth schema.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.users (id) on delete set null,
  role_id uuid not null references public.roles (id),
  display_name text not null check (length(trim(display_name)) between 1 and 100),
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name_th text not null check (length(trim(name_th)) between 1 and 100),
  name_en text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories (id) on delete set null,
  sku text unique,
  name_th text not null check (length(trim(name_th)) between 1 and 150),
  name_en text,
  description text,
  price numeric(12,2) not null check (price >= 0),
  image_path text,
  inventory_mode public.inventory_mode not null default 'RECIPE',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ingredient_categories (
  id uuid primary key default gen_random_uuid(),
  name_th text not null unique,
  name_en text,
  created_at timestamptz not null default now()
);

-- Raw materials AND finished goods (item_type = FINISHED, linked to a product).
create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.ingredient_categories (id) on delete set null,
  sku text unique,
  name_th text not null check (length(trim(name_th)) between 1 and 150),
  name_en text,
  unit text not null check (length(trim(unit)) between 1 and 20),
  item_type public.item_type not null default 'RAW',
  product_id uuid unique references public.products (id) on delete restrict,
  stock_qty numeric(14,4) not null default 0,
  avg_cost numeric(14,4) not null default 0 check (avg_cost >= 0),
  reorder_level numeric(14,4) not null default 0 check (reorder_level >= 0),
  allow_negative boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finished_has_product check ((item_type = 'FINISHED') = (product_id is not null))
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  version integer not null default 1,
  yield_quantity numeric(14,4) not null check (yield_quantity > 0),   -- yield units per batch
  yield_unit text not null default 'ชิ้น',
  units_per_sale numeric(14,4) not null default 1 check (units_per_sale > 0), -- yield units in one sold product
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A product can have only ONE active recipe.
create unique index recipes_one_active_per_product on public.recipes (product_id) where is_active;

create table public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete restrict,
  quantity numeric(14,4) not null check (quantity > 0),  -- per batch, ingredient base unit
  note text,
  unique (recipe_id, ingredient_id)
);

-- ---------------------------------------------------------------------------
-- Purchasing
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 150),
  contact_name text,
  phone text,
  email text,
  tax_id text,
  address text,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  supplier_id uuid not null references public.suppliers (id),
  status public.purchase_status not null default 'DRAFT',
  order_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  expected_date date,
  received_at timestamptz,
  subtotal numeric(12,2) not null default 0,
  note text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  quantity numeric(14,4) not null check (quantity > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  received_quantity numeric(14,4) not null default 0 check (received_quantity >= 0),
  line_total numeric(12,2) generated always as (round(quantity * unit_cost, 2)) stored
);

-- ---------------------------------------------------------------------------
-- Inventory ledger (append-only)
-- ---------------------------------------------------------------------------
create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id),
  transaction_type public.inventory_txn_type not null,
  quantity numeric(14,4) not null check (quantity <> 0),   -- signed: + in, - out
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  total_cost numeric(14,4) generated always as (round(quantity * unit_cost, 4)) stored,
  balance_after numeric(14,4),
  reference_type text,
  reference_id uuid,
  note text,
  user_id uuid references public.users (id),
  created_at timestamptz not null default now()
);
create index inventory_transactions_ingredient_idx on public.inventory_transactions (ingredient_id, created_at desc);
create index inventory_transactions_reference_idx on public.inventory_transactions (reference_type, reference_id);

create table public.waste (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id),
  quantity numeric(14,4) not null check (quantity > 0),
  unit_cost numeric(14,4) not null default 0,
  total_cost numeric(12,2) generated always as (round(quantity * unit_cost, 2)) stored,
  reason text not null,
  inventory_transaction_id uuid references public.inventory_transactions (id),
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Production
-- ---------------------------------------------------------------------------
create table public.production (
  id uuid primary key default gen_random_uuid(),
  production_number text not null unique,
  recipe_id uuid not null references public.recipes (id),
  product_id uuid not null references public.products (id),
  finished_item_id uuid not null references public.ingredients (id),
  batches numeric(14,4) not null check (batches > 0),
  yield_per_batch numeric(14,4) not null check (yield_per_batch > 0),
  planned_output numeric(14,4) not null,
  actual_output numeric(14,4),
  status public.production_status not null default 'PLANNED',
  total_cost numeric(12,2),
  unit_cost numeric(14,4),
  note text,
  created_by uuid references public.users (id),
  completed_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.production_items (
  id uuid primary key default gen_random_uuid(),
  production_id uuid not null references public.production (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id),
  required_quantity numeric(14,4) not null check (required_quantity > 0),
  unit_cost numeric(14,4),
  total_cost numeric(12,2)
);

-- ---------------------------------------------------------------------------
-- Customers & promotions
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  phone text unique check (phone ~ '^0[0-9]{8,9}$'),
  name text not null check (length(trim(name)) between 1 and 150),
  email text,
  birthday date,
  points_balance integer not null default 0 check (points_balance >= 0),
  total_spent numeric(12,2) not null default 0,
  visit_count integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  code text unique check (code is null or code ~ '^[A-Z0-9_-]{2,30}$'),
  name text not null,
  discount_type public.discount_type not null,
  value numeric(12,2) not null check (value > 0),
  min_subtotal numeric(12,2) not null default 0 check (min_subtotal >= 0),
  max_discount numeric(12,2) check (max_discount is null or max_discount > 0),
  members_only boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint percent_max_100 check (discount_type <> 'PERCENT' or value <= 100),
  constraint valid_window check (starts_at is null or ends_at is null or starts_at < ends_at)
);

-- ---------------------------------------------------------------------------
-- Cash sessions
-- ---------------------------------------------------------------------------
create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  status public.cash_session_status not null default 'OPEN',
  opening_cash numeric(12,2) not null check (opening_cash >= 0),
  expected_cash numeric(12,2),
  actual_cash numeric(12,2),
  variance numeric(12,2),
  opened_by uuid not null references public.users (id),
  closed_by uuid references public.users (id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  note text
);
-- Single register: only one OPEN session at a time.
create unique index cash_sessions_one_open on public.cash_sessions ((true)) where status = 'OPEN';

create table public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions (id),
  transaction_type public.cash_txn_type not null,
  amount numeric(12,2) not null,   -- signed: + into drawer, - out of drawer
  reference_type text,
  reference_id uuid,
  note text,
  user_id uuid references public.users (id),
  created_at timestamptz not null default now()
);
create index cash_transactions_session_idx on public.cash_transactions (cash_session_id);

-- ---------------------------------------------------------------------------
-- Orders, payments, refunds
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  queue_number integer not null,
  business_date date not null,                 -- Asia/Bangkok calendar date
  status public.order_status not null default 'COMPLETED',
  kitchen_status public.kitchen_status not null default 'PENDING',
  order_type public.order_type not null default 'TAKEAWAY',
  table_label text,
  customer_id uuid references public.customers (id),
  promotion_id uuid references public.promotions (id),
  cash_session_id uuid references public.cash_sessions (id),
  subtotal numeric(12,2) not null,
  promotion_discount numeric(12,2) not null default 0,
  manual_discount numeric(12,2) not null default 0,
  points_redeemed integer not null default 0,
  points_discount numeric(12,2) not null default 0,
  vat_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null check (total >= 0),
  refunded_total numeric(12,2) not null default 0,
  cogs_total numeric(12,2) not null default 0,
  points_earned integer not null default 0,
  note text,
  cancel_reason text,
  created_by uuid references public.users (id),
  cancelled_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (business_date, queue_number)
);
create index orders_business_date_idx on public.orders (business_date);
create index orders_kitchen_idx on public.orders (kitchen_status) where status = 'COMPLETED';

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id),
  product_name text not null,            -- snapshot
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null,
  unit_cost numeric(14,4) not null default 0,
  cogs_total numeric(12,2) not null default 0,
  refunded_quantity integer not null default 0 check (refunded_quantity >= 0),
  note text,
  constraint refund_not_exceed check (refunded_quantity <= quantity)
);
create index order_items_order_idx on public.order_items (order_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  method public.payment_method not null,
  amount numeric(12,2) not null check (amount > 0),     -- amount applied to the bill
  tendered numeric(12,2),                               -- cash handed over (CASH only)
  change_amount numeric(12,2) not null default 0,
  reference text,
  created_at timestamptz not null default now()
);
create index payments_order_idx on public.payments (order_id);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  refund_number text not null unique,
  order_id uuid not null references public.orders (id),
  amount numeric(12,2) not null check (amount > 0),
  method public.payment_method not null,
  reason text not null,
  restock boolean not null default false,
  items jsonb not null default '[]'::jsonb,   -- [{order_item_id, quantity, amount}]
  cogs_reversed numeric(12,2) not null default 0,
  cash_session_id uuid references public.cash_sessions (id),
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create table public.customer_points (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id),
  change integer not null check (change <> 0),
  balance_after integer not null check (balance_after >= 0),
  reason public.points_reason not null,
  order_id uuid references public.orders (id),
  note text,
  user_id uuid references public.users (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null check (length(trim(category)) between 1 and 60),
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  payment_method public.payment_method not null default 'CASH',
  supplier_id uuid references public.suppliers (id),
  cash_session_id uuid references public.cash_sessions (id),
  receipt_path text,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);
create index expenses_date_idx on public.expenses (expense_date);

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity, entity_id);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

-- =============================================================================
-- Helper functions
-- =============================================================================

-- Role of the calling user (null when not an active employee).
create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select r.code
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.user_id = auth.uid() and e.is_active
  limit 1
$$;

create or replace function public.has_role(variadic allowed public.app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_app_role() = any (allowed), false)
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$ select public.current_app_role() is not null $$;

-- Raise a permission error unless the caller has one of the roles.
create or replace function public.require_role(variadic allowed public.app_role[])
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_role(variadic allowed) then
    raise exception 'permission denied: requires role %', allowed using errcode = '42501';
  end if;
end $$;

-- Bangkok business date for a timestamp.
create or replace function public.bkk_date(ts timestamptz default now())
returns date language sql immutable as $$ select (ts at time zone 'Asia/Bangkok')::date $$;

-- Generic audit writer (also callable from RPCs for business events).
create or replace function public.write_audit(
  p_action text, p_entity text, p_entity_id uuid, p_old jsonb default null, p_new jsonb default null
) returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_logs (user_id, action, entity, entity_id, old_value, new_value)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_old, p_new)
$$;
revoke execute on function public.write_audit(text, text, uuid, jsonb, jsonb) from public, anon, authenticated;

-- Row-change audit trigger.
create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('INSERT', tg_table_name, new.id, null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(old) is distinct from to_jsonb(new) then
      perform public.write_audit('UPDATE', tg_table_name, new.id, to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    perform public.write_audit('DELETE', tg_table_name, old.id, to_jsonb(old), null);
    return old;
  end if;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.prevent_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op using errcode = '42501';
end $$;

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['employees','categories','products','ingredients','recipes','suppliers',
                           'purchase_orders','customers','promotions']
  loop
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;

-- audit triggers on master data (business-event RPCs write their own audit rows too)
do $$
declare t text;
begin
  foreach t in array array['employees','settings','categories','products','ingredient_categories','ingredients',
                           'recipes','recipe_items','suppliers','purchase_orders','purchase_items','customers',
                           'promotions','expenses','cash_sessions','production']
  loop
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
  end loop;
end $$;

-- append-only tables
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.prevent_mutation();
create trigger inventory_transactions_immutable before update or delete on public.inventory_transactions
  for each row execute function public.prevent_mutation();
create trigger cash_transactions_immutable before update or delete on public.cash_transactions
  for each row execute function public.prevent_mutation();
create trigger customer_points_immutable before update or delete on public.customer_points
  for each row execute function public.prevent_mutation();

-- Mirror auth.users → public.users
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.users (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end $$;

create trigger on_auth_user_created after insert or update of email on auth.users
  for each row execute function public.handle_new_auth_user();

-- =============================================================================
-- Seed reference data
-- =============================================================================
insert into public.roles (code, name_th, name_en) values
  ('OWNER', 'เจ้าของร้าน', 'Owner'),
  ('MANAGER', 'ผู้จัดการ', 'Manager'),
  ('CASHIER', 'แคชเชียร์', 'Cashier'),
  ('KITCHEN', 'ครัว', 'Kitchen');

insert into public.settings (key, value) values
  ('shop_name', '"Custard"'),
  ('shop_address', '""'),
  ('shop_phone', '""'),
  ('tax_id', '""'),
  ('vat_enabled', 'false'),
  ('vat_rate', '7'),
  ('vat_inclusive', 'true'),
  ('promptpay_id', '""'),
  ('baht_per_point', '25'),
  ('point_value', '1'),
  ('min_redeem_points', '10'),
  ('max_cashier_discount', '50'),
  ('receipt_footer', '"ขอบคุณค่ะ"'),
  ('locale', '"th"');

-- =============================================================================
-- Row Level Security
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['roles','users','employees','settings','categories','products','ingredient_categories',
    'ingredients','recipes','recipe_items','suppliers','purchase_orders','purchase_items','inventory_transactions',
    'waste','production','production_items','customers','promotions','cash_sessions','cash_transactions','orders',
    'order_items','payments','refunds','customer_points','expenses','audit_logs']
  loop
    -- Not FORCEd: SECURITY DEFINER functions (owned by the migration role) must bypass RLS;
    -- API roles (anon/authenticated) never own tables, so RLS always applies to them.
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Readable by every active employee
do $$
declare t text;
begin
  foreach t in array array['roles','settings','categories','products','orders','order_items']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_staff())', t || '_read_staff', t);
  end loop;
end $$;

-- Readable by front-of-house (owner, manager, cashier)
do $$
declare t text;
begin
  foreach t in array array['ingredient_categories','ingredients','recipes','recipe_items','customers','promotions',
    'payments','refunds','customer_points','cash_sessions','cash_transactions','production','production_items','waste']
  loop
    execute format($p$create policy %I on public.%I for select to authenticated
      using (public.has_role('OWNER','MANAGER','CASHIER'))$p$, t || '_read_foh', t);
  end loop;
end $$;

-- Readable by management only
do $$
declare t text;
begin
  foreach t in array array['suppliers','purchase_orders','purchase_items','inventory_transactions','expenses','users']
  loop
    execute format($p$create policy %I on public.%I for select to authenticated
      using (public.has_role('OWNER','MANAGER'))$p$, t || '_read_mgmt', t);
  end loop;
end $$;

create policy audit_logs_read_owner on public.audit_logs for select to authenticated using (public.has_role('OWNER'));
create policy employees_read on public.employees for select to authenticated
  using (public.has_role('OWNER','MANAGER') or user_id = auth.uid());

-- Direct writes: master data managed by OWNER/MANAGER
do $$
declare t text;
begin
  foreach t in array array['categories','products','ingredient_categories','ingredients','recipes','recipe_items',
                           'suppliers','promotions']
  loop
    execute format($p$create policy %I on public.%I for insert to authenticated with check (public.has_role('OWNER','MANAGER'))$p$, t || '_insert_mgmt', t);
    execute format($p$create policy %I on public.%I for update to authenticated using (public.has_role('OWNER','MANAGER')) with check (public.has_role('OWNER','MANAGER'))$p$, t || '_update_mgmt', t);
  end loop;
end $$;
-- Hard deletes only by OWNER, and only where FKs allow (prefer is_active=false).
do $$
declare t text;
begin
  foreach t in array array['categories','products','recipe_items','promotions','ingredient_categories']
  loop
    execute format($p$create policy %I on public.%I for delete to authenticated using (public.has_role('OWNER','MANAGER'))$p$, t || '_delete_mgmt', t);
  end loop;
end $$;

-- Customers: front-of-house can register/edit (points via RPC only — see column grants)
create policy customers_insert_foh on public.customers for insert to authenticated
  with check (public.has_role('OWNER','MANAGER','CASHIER'));
create policy customers_update_foh on public.customers for update to authenticated
  using (public.has_role('OWNER','MANAGER','CASHIER')) with check (public.has_role('OWNER','MANAGER','CASHIER'));

-- Owner-only administration
create policy settings_write_owner on public.settings for update to authenticated
  using (public.has_role('OWNER')) with check (public.has_role('OWNER'));
create policy employees_write_owner on public.employees for all to authenticated
  using (public.has_role('OWNER')) with check (public.has_role('OWNER'));

-- Tables WITHOUT write policies are mutated only through SECURITY DEFINER RPCs:
-- orders, order_items, payments, refunds, inventory_transactions, waste, production*,
-- purchase_*, cash_*, customer_points, expenses, audit_logs.

-- Column-level protection (applies even when a row policy allows update).
-- Supabase grants ALL on new public tables to anon/authenticated by default; start from zero.
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.categories, public.products, public.ingredient_categories, public.recipes,
  public.recipe_items, public.suppliers, public.promotions, public.employees to authenticated;
grant update on public.settings to authenticated;
grant insert on public.customers to authenticated;
grant update (name, phone, email, birthday, note) on public.customers to authenticated;
grant insert (category_id, sku, name_th, name_en, unit, item_type, product_id, reorder_level, allow_negative, is_active)
  on public.ingredients to authenticated;
grant update (category_id, sku, name_th, name_en, unit, reorder_level, allow_negative, is_active)
  on public.ingredients to authenticated;
-- stock_qty and avg_cost are NOT granted: they change only through the inventory ledger.


-- =============================================================================
-- Bootstrap: the very first signed-in user becomes OWNER (only while no employees exist).
-- =============================================================================
create or replace function public.claim_first_owner(p_display_name text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  lock table public.employees in exclusive mode;
  if exists (select 1 from public.employees) then
    raise exception 'INVALID_STATE: employees already exist' using errcode = 'P0001';
  end if;
  insert into public.users (id, email) select id, email from auth.users where id = v_uid
  on conflict (id) do nothing;
  insert into public.employees (user_id, role_id, display_name)
  select v_uid, r.id, coalesce(nullif(trim(p_display_name), ''), 'Owner') from public.roles r where r.code = 'OWNER'
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.claim_first_owner(text) from public, anon;
grant execute on function public.current_app_role(), public.has_role(public.app_role[]), public.is_staff(),
  public.claim_first_owner(text) to authenticated;

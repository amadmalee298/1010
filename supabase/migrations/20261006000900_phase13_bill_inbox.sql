-- =============================================================================
-- Phase 13: Bill inbox — staff send bills from Telegram (photo read by AI, or a
-- text-only "no receipt" expense); a manager approves each submission, which
-- posts ingredient purchases to the stock ledger and records the rest as an
-- expense. Submissions without a receipt get a substitute-receipt number
-- (ใบรับรองแทนใบเสร็จรับเงิน) such as 2569/10-001.
--
-- The Telegram webhook has no user session: it calls the telegram_* / submit_bill
-- functions with the service role only. Approval runs as the signed-in manager.
-- =============================================================================

-- Legal name printed on documents such as the substitute receipt (blank = shop name).
insert into public.settings (key, value) values ('company_name', '""') on conflict (key) do nothing;

create type public.bill_status as enum ('PENDING', 'APPROVED', 'REJECTED');

create table public.telegram_accounts (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique,
  employee_id uuid not null unique references public.employees (id) on delete cascade,
  chat_id bigint not null,
  username text,
  linked_at timestamptz not null default now()
);

create table public.telegram_link_codes (
  code text primary key check (code ~ '^[A-Z0-9]{8}$'),
  employee_id uuid not null references public.employees (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.bill_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_number text not null unique,
  source text not null check (source in ('TELEGRAM', 'APP')),
  telegram_update_id bigint unique,
  telegram_chat_id bigint,
  submitted_by uuid references public.employees (id) on delete set null,
  submitter_name text not null,
  has_receipt boolean not null,
  photo_path text,
  photo_url text,
  message_text text,
  extraction jsonb,
  extraction_error text,
  vendor text,
  bill_date date,
  total numeric(12,2) check (total is null or total >= 0),
  status public.bill_status not null default 'PENDING',
  reviewed_by uuid references public.users (id),
  reviewed_at timestamptz,
  review_note text,
  approved_lines jsonb,
  expense_id uuid references public.expenses (id),
  substitute_number text unique,
  substitute_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint receipt_has_photo check (not has_receipt or photo_path is not null)
);
create index bill_submissions_status_idx on public.bill_submissions (status, created_at desc);

create trigger bill_submissions_touch before update on public.bill_submissions
  for each row execute function public.touch_updated_at();
create trigger bill_submissions_audit after insert or update or delete on public.bill_submissions
  for each row execute function public.audit_row_change();
create trigger telegram_accounts_audit after insert or update or delete on public.telegram_accounts
  for each row execute function public.audit_row_change();

alter table public.telegram_accounts enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.bill_submissions enable row level security;

create policy telegram_accounts_read on public.telegram_accounts for select to authenticated
  using (public.has_role('OWNER') or employee_id in (select id from public.employees where user_id = auth.uid()));
create policy bill_submissions_read on public.bill_submissions for select to authenticated
  using (public.has_role('OWNER', 'MANAGER')
         or submitted_by in (select id from public.employees where user_id = auth.uid()));
grant select on public.telegram_accounts, public.bill_submissions to authenticated;
-- telegram_link_codes: no direct access; codes are issued and redeemed by functions.

-- -----------------------------------------------------------------------------
-- Numbering
-- -----------------------------------------------------------------------------

-- Substitute-receipt number per Bangkok month, Buddhist-era year: 2569/10-001
create or replace function public.next_substitute_number()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_today date := public.bkk_date(now());
  v_stem text := (extract(year from v_today)::int + 543)::text || '/' || to_char(v_today, 'MM') || '-';
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtext('docno:substitute'));
  select coalesce(max(substring(substitute_number from length(v_stem) + 1)::integer), 0) + 1
    into v_next from public.bill_submissions where substitute_number like v_stem || '%';
  return v_stem || lpad(v_next::text, 3, '0');
end $$;
revoke execute on function public.next_substitute_number() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Telegram linking
-- -----------------------------------------------------------------------------

-- Any active employee: one-time code to send to the bot as /start CODE (valid 30 minutes).
create or replace function public.create_telegram_link_code()
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_employee uuid;
  v_code text;
begin
  select id into v_employee from public.employees where user_id = auth.uid() and is_active;
  if v_employee is null then raise exception 'permission denied: not an employee' using errcode = '42501'; end if;
  delete from public.telegram_link_codes where employee_id = v_employee or expires_at < now();
  v_code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
  insert into public.telegram_link_codes (code, employee_id, expires_at) values (v_code, v_employee, now() + interval '30 minutes');
  return v_code;
end $$;

-- Own link, or any link for the owner.
create or replace function public.unlink_telegram(p_employee_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.has_role('OWNER')
          or p_employee_id in (select id from public.employees where user_id = auth.uid())) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  delete from public.telegram_accounts where employee_id = p_employee_id;
end $$;

-- Webhook (service role): redeem a code. Returns the employee's display name.
create or replace function public.telegram_link_account(p_code text, p_telegram_user_id bigint, p_chat_id bigint, p_username text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_employee uuid;
  v_name text;
begin
  delete from public.telegram_link_codes where code = upper(trim(p_code)) and expires_at >= now()
  returning employee_id into v_employee;
  if v_employee is null then raise exception 'NOT_FOUND: link code' using errcode = 'P0001'; end if;
  select display_name into v_name from public.employees where id = v_employee and is_active;
  if v_name is null then raise exception 'NOT_FOUND: employee' using errcode = 'P0001'; end if;
  delete from public.telegram_accounts where employee_id = v_employee or telegram_user_id = p_telegram_user_id;
  insert into public.telegram_accounts (telegram_user_id, employee_id, chat_id, username)
  values (p_telegram_user_id, v_employee, p_chat_id, nullif(trim(p_username), ''));
  return v_name;
end $$;

-- Webhook (service role): who is this Telegram user? Empty when unlinked or inactive.
create or replace function public.telegram_employee(p_telegram_user_id bigint)
returns table (employee_id uuid, display_name text)
language sql stable security definer set search_path = public
as $$
  select e.id, e.display_name
  from public.telegram_accounts t join public.employees e on e.id = t.employee_id
  where t.telegram_user_id = p_telegram_user_id and e.is_active
$$;

-- Webhook (service role): store a submission. Idempotent per Telegram update.
create or replace function public.submit_bill(
  p_telegram_update_id bigint, p_chat_id bigint, p_employee_id uuid, p_has_receipt boolean,
  p_photo_path text, p_message_text text, p_extraction jsonb, p_extraction_error text,
  p_vendor text, p_bill_date date, p_total numeric
) returns public.bill_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.bill_submissions;
  v_name text;
begin
  select * into v_row from public.bill_submissions where telegram_update_id = p_telegram_update_id;
  if found then return v_row; end if;
  select display_name into v_name from public.employees where id = p_employee_id and is_active;
  if v_name is null then raise exception 'NOT_FOUND: employee' using errcode = 'P0001'; end if;
  insert into public.bill_submissions (submission_number, source, telegram_update_id, telegram_chat_id, submitted_by,
    submitter_name, has_receipt, photo_path, message_text, extraction, extraction_error, vendor, bill_date, total)
  values (public.next_document_number('BL', 'public.bill_submissions', 'submission_number'), 'TELEGRAM',
    p_telegram_update_id, p_chat_id, p_employee_id, v_name, p_has_receipt, p_photo_path, nullif(trim(p_message_text), ''),
    p_extraction, p_extraction_error, nullif(trim(p_vendor), ''), p_bill_date,
    case when p_total is null or p_total < 0 then null else round(p_total, 2) end)
  returning * into v_row;
  return v_row;
end $$;

revoke execute on function
  public.telegram_link_account(text, bigint, bigint, text), public.telegram_employee(bigint),
  public.submit_bill(bigint, bigint, uuid, boolean, text, text, jsonb, text, text, date, numeric)
from public, anon, authenticated;
grant execute on function
  public.telegram_link_account(text, bigint, bigint, text), public.telegram_employee(bigint),
  public.submit_bill(bigint, bigint, uuid, boolean, text, text, jsonb, text, text, date, numeric)
to service_role;

-- -----------------------------------------------------------------------------
-- Review
-- -----------------------------------------------------------------------------

-- Approve a pending bill. p_lines: [{description, amount, ingredient_id?, quantity?}]
--  * lines with ingredient_id → PURCHASE into the stock ledger (unit cost = amount / quantity)
--  * other lines → one operating expense in p_category
-- Paid from the drawer: the expense is an EXPENSE cash transaction, the stock part a WITHDRAWAL.
create or replace function public.approve_bill(
  p_id uuid, p_bill_date date, p_vendor text, p_lines jsonb, p_category text,
  p_payment_method public.payment_method default 'CASH', p_from_drawer boolean default false
) returns public.bill_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_bill public.bill_submissions;
  v_line jsonb;
  v_amount numeric;
  v_qty numeric;
  v_ingredient public.ingredients;
  v_stock_total numeric := 0;
  v_expense_total numeric := 0;
  v_expense_desc text[] := '{}';
  v_session uuid;
  v_expense public.expenses;
  v_date date := coalesce(p_bill_date, public.bkk_date(now()));
  v_vendor text := nullif(trim(p_vendor), '');
begin
  perform public.require_role('OWNER', 'MANAGER');
  select * into v_bill from public.bill_submissions where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: bill' using errcode = 'P0001'; end if;
  if v_bill.status <> 'PENDING' then raise exception 'INVALID_STATE: bill is %', v_bill.status using errcode = 'P0001'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'VALIDATION: at least one line is required' using errcode = 'P0001';
  end if;
  if p_from_drawer then
    if p_payment_method <> 'CASH' then raise exception 'VALIDATION: drawer payments must be cash' using errcode = 'P0001'; end if;
    v_session := public.current_cash_session_id();
    if v_session is null then raise exception 'NO_OPEN_SESSION' using errcode = 'P0001'; end if;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_amount := (v_line ->> 'amount')::numeric;
    if v_amount is null or v_amount <= 0 or round(v_amount, 2) <> v_amount then
      raise exception 'VALIDATION: amount must be > 0 with at most 2 decimals' using errcode = 'P0001';
    end if;
    if length(trim(coalesce(v_line ->> 'description', ''))) = 0 then
      raise exception 'VALIDATION: every line needs a description' using errcode = 'P0001';
    end if;
    if nullif(v_line ->> 'ingredient_id', '') is not null then
      v_qty := (v_line ->> 'quantity')::numeric;
      if v_qty is null or v_qty <= 0 then raise exception 'VALIDATION: quantity must be > 0' using errcode = 'P0001'; end if;
      select * into v_ingredient from public.ingredients where id = (v_line ->> 'ingredient_id')::uuid;
      if not found or not v_ingredient.is_active then raise exception 'NOT_FOUND: ingredient' using errcode = 'P0001'; end if;
      if v_ingredient.item_type <> 'RAW' then
        raise exception 'VALIDATION: only raw ingredients can be purchased' using errcode = 'P0001';
      end if;
      perform public.post_inventory(v_ingredient.id, 'PURCHASE', v_qty, v_amount / v_qty, 'bill_submission', p_id,
        v_bill.submission_number || coalesce(' ' || v_vendor, ''));
      v_stock_total := v_stock_total + v_amount;
    else
      v_expense_total := v_expense_total + v_amount;
      v_expense_desc := v_expense_desc || trim(v_line ->> 'description');
    end if;
  end loop;

  if v_expense_total > 0 then
    if length(trim(coalesce(p_category, ''))) = 0 then
      raise exception 'VALIDATION: expense category is required' using errcode = 'P0001';
    end if;
    insert into public.expenses (expense_date, category, description, amount, payment_method, cash_session_id, receipt_path, created_by)
    values (v_date, trim(p_category),
            left(coalesce(v_vendor || ': ', '') || array_to_string(v_expense_desc, ', ') || ' (' || v_bill.submission_number || ')', 500),
            v_expense_total, p_payment_method, v_session, v_bill.photo_path, auth.uid())
    returning * into v_expense;
    if v_session is not null then
      insert into public.cash_transactions (cash_session_id, transaction_type, amount, reference_type, reference_id, note, user_id)
      values (v_session, 'EXPENSE', -v_expense_total, 'expense', v_expense.id, v_bill.submission_number, auth.uid());
    end if;
  end if;
  if v_stock_total > 0 and v_session is not null then
    insert into public.cash_transactions (cash_session_id, transaction_type, amount, reference_type, reference_id, note, user_id)
    values (v_session, 'WITHDRAWAL', -v_stock_total, 'bill_submission', p_id, v_bill.submission_number, auth.uid());
  end if;

  update public.bill_submissions
     set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now(), bill_date = v_date, vendor = v_vendor,
         total = v_stock_total + v_expense_total, approved_lines = p_lines, expense_id = v_expense.id,
         substitute_number = case when has_receipt then null else public.next_substitute_number() end
   where id = p_id
  returning * into v_bill;
  perform public.write_audit('APPROVE_BILL', 'bill_submissions', p_id, null,
    jsonb_build_object('lines', p_lines, 'stock', v_stock_total, 'expense', v_expense_total, 'from_drawer', p_from_drawer));
  return v_bill;
end $$;

create or replace function public.reject_bill(p_id uuid, p_reason text)
returns public.bill_submissions
language plpgsql security definer set search_path = public
as $$
declare v_bill public.bill_submissions;
begin
  perform public.require_role('OWNER', 'MANAGER');
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'VALIDATION: a reason is required' using errcode = 'P0001'; end if;
  update public.bill_submissions
     set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_note = trim(p_reason)
   where id = p_id and status = 'PENDING'
  returning * into v_bill;
  if not found then raise exception 'INVALID_STATE: bill is not pending' using errcode = 'P0001'; end if;
  return v_bill;
end $$;

-- Record where the photo / substitute receipt were filed in Google Drive.
create or replace function public.set_bill_links(p_id uuid, p_photo_url text, p_substitute_url text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_role('OWNER', 'MANAGER');
  update public.bill_submissions
     set photo_url = coalesce(nullif(trim(p_photo_url), ''), photo_url),
         substitute_url = coalesce(nullif(trim(p_substitute_url), ''), substitute_url)
   where id = p_id;
  if not found then raise exception 'NOT_FOUND: bill' using errcode = 'P0001'; end if;
end $$;

grant execute on function
  public.create_telegram_link_code(), public.unlink_telegram(uuid),
  public.approve_bill(uuid, date, text, jsonb, text, public.payment_method, boolean),
  public.reject_bill(uuid, text), public.set_bill_links(uuid, text, text)
to authenticated;

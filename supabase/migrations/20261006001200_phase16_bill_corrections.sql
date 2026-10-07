-- =============================================================================
-- Phase 16: Bill corrections and evidence
--  * real names: employees.legal_name is printed on documents (fallback: display name)
--  * an approved bill can be voided (stock, expense and cash are reversed) and its
--    substitute receipt edited (names, date, descriptions, notes — never amounts)
--  * attachments: transfer slips and other purchase evidence, from the app or by
--    replying to the bot's confirmation in Telegram
-- =============================================================================

alter table public.employees add column legal_name text check (legal_name is null or length(trim(legal_name)) <= 150);

create or replace view public.employee_directory with (security_invoker = true) as
select e.id, e.user_id, e.display_name, e.phone, e.is_active, e.created_at, r.code as role, u.email, e.legal_name
from public.employees e
join public.roles r on r.id = e.role_id
left join public.users u on u.id = e.user_id;
grant select on public.employee_directory to authenticated;

alter table public.bill_submissions
  add column payer_name text,
  add column voided_at timestamptz,
  add column void_reason text,
  add column voided_by uuid references public.users (id);
update public.bill_submissions set payer_name = submitter_name where status = 'APPROVED' and payer_name is null;

-- -----------------------------------------------------------------------------
-- Attachments
-- -----------------------------------------------------------------------------
create table public.bill_attachments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bill_submissions (id),
  kind text not null check (kind in ('SLIP', 'EVIDENCE', 'OTHER')),
  path text not null,
  drive_url text,
  uploaded_by uuid references public.users (id),
  created_at timestamptz not null default now()
);
create index bill_attachments_bill_idx on public.bill_attachments (bill_id);
create trigger bill_attachments_audit after insert or update or delete on public.bill_attachments
  for each row execute function public.audit_row_change();
alter table public.bill_attachments enable row level security;
create policy bill_attachments_read on public.bill_attachments for select to authenticated
  using (bill_id in (select id from public.bill_submissions));   -- same visibility as the bill
grant select on public.bill_attachments to authenticated;

create or replace function public.add_bill_attachment(p_bill_id uuid, p_kind text, p_path text)
returns public.bill_attachments
language plpgsql security definer set search_path = public
as $$
declare v_row public.bill_attachments;
begin
  perform public.require_role('OWNER', 'MANAGER');
  if not exists (select 1 from public.bill_submissions where id = p_bill_id) then
    raise exception 'NOT_FOUND: bill' using errcode = 'P0001';
  end if;
  if p_path is null or p_path !~ '^bills/[A-Za-z0-9/_.-]+$' then raise exception 'VALIDATION: invalid path' using errcode = 'P0001'; end if;
  insert into public.bill_attachments (bill_id, kind, path, uploaded_by) values (p_bill_id, upper(p_kind), p_path, auth.uid())
  returning * into v_row;
  return v_row;
end $$;

-- Webhook (service role): a photo sent as a reply to the bot's confirmation. The sender must be
-- the bill's submitter or an owner/manager.
create or replace function public.telegram_add_attachment(p_telegram_user_id bigint, p_submission_number text, p_path text)
returns public.bill_attachments
language plpgsql security definer set search_path = public
as $$
declare
  v_staff record;
  v_bill public.bill_submissions;
  v_row public.bill_attachments;
begin
  select * into v_staff from public.telegram_staff(p_telegram_user_id);
  if v_staff.employee_id is null then raise exception 'NOT_FOUND: linked employee' using errcode = 'P0001'; end if;
  select * into v_bill from public.bill_submissions where submission_number = p_submission_number;
  if not found or not (v_bill.submitted_by = v_staff.employee_id or v_staff.role in ('OWNER', 'MANAGER')) then
    raise exception 'NOT_FOUND: bill' using errcode = 'P0001';
  end if;
  insert into public.bill_attachments (bill_id, kind, path, uploaded_by) values (v_bill.id, 'EVIDENCE', p_path, v_staff.user_id)
  returning * into v_row;
  return v_row;
end $$;

-- Records where an attachment was filed in Google Drive (webhook, or a manager in the app).
create or replace function public.set_attachment_drive_url(p_id uuid, p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then perform public.require_role('OWNER', 'MANAGER'); end if;
  update public.bill_attachments set drive_url = nullif(trim(p_url), '') where id = p_id;
end $$;

-- -----------------------------------------------------------------------------
-- Edit the substitute receipt (wording only; amounts are fixed by the approval)
-- p_lines: [{description, note}] in the same order and number as the approved lines
-- -----------------------------------------------------------------------------
create or replace function public.edit_substitute(
  p_id uuid, p_bill_date date, p_payer_name text, p_approver_name text, p_lines jsonb
) returns public.bill_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_bill public.bill_submissions;
  v_new jsonb := '[]'::jsonb;
  v_old jsonb;
  v_i integer := 0;
begin
  perform public.require_role('OWNER', 'MANAGER');
  select * into v_bill from public.bill_submissions where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: bill' using errcode = 'P0001'; end if;
  if v_bill.status <> 'APPROVED' or v_bill.voided_at is not null or v_bill.substitute_number is null then
    raise exception 'INVALID_STATE: only an approved, active substitute receipt can be edited' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_payer_name, ''))) = 0 then raise exception 'VALIDATION: payer name is required' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) <> jsonb_array_length(v_bill.approved_lines) then
    raise exception 'VALIDATION: lines must match the approved lines' using errcode = 'P0001';
  end if;
  for v_old in select * from jsonb_array_elements(v_bill.approved_lines) loop
    if length(trim(coalesce(p_lines -> v_i ->> 'description', ''))) = 0 then
      raise exception 'VALIDATION: every line needs a description' using errcode = 'P0001';
    end if;
    v_new := v_new || jsonb_build_array(v_old
      || jsonb_build_object('description', left(trim(p_lines -> v_i ->> 'description'), 200))
      || jsonb_build_object('note', nullif(left(trim(coalesce(p_lines -> v_i ->> 'note', '')), 200), '')));
    v_i := v_i + 1;
  end loop;
  update public.bill_submissions
     set approved_lines = v_new, payer_name = left(trim(p_payer_name), 150),
         approver_name = nullif(left(trim(coalesce(p_approver_name, '')), 150), ''),
         bill_date = coalesce(p_bill_date, bill_date), substitute_url = null
   where id = p_id
  returning * into v_bill;
  return v_bill;
end $$;

-- -----------------------------------------------------------------------------
-- Void an approved bill: stock out (at average cost), expense voided, drawer refilled.
-- The ledger reverses the payment on the void date (see gl_lines 'bill_void').
-- -----------------------------------------------------------------------------
create or replace function public.void_bill(p_id uuid, p_reason text)
returns public.bill_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_bill public.bill_submissions;
  v_line jsonb;
  v_stock numeric := 0;
  v_session uuid;
  v_expense public.expenses;
begin
  perform public.require_role('OWNER', 'MANAGER');
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'VALIDATION: a reason is required' using errcode = 'P0001'; end if;
  select * into v_bill from public.bill_submissions where id = p_id for update;
  if not found then raise exception 'NOT_FOUND: bill' using errcode = 'P0001'; end if;
  if v_bill.status <> 'APPROVED' or v_bill.voided_at is not null then
    raise exception 'INVALID_STATE: only an approved bill can be voided' using errcode = 'P0001';
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(v_bill.approved_lines, '[]'::jsonb)) loop
    if nullif(v_line ->> 'ingredient_id', '') is not null then
      perform public.post_inventory((v_line ->> 'ingredient_id')::uuid, 'ADJUSTMENT', -((v_line ->> 'quantity')::numeric), null,
        'bill_void', p_id, 'ยกเลิก ' || v_bill.submission_number);
      v_stock := v_stock + (v_line ->> 'amount')::numeric;
    end if;
  end loop;

  if v_bill.expense_id is not null then
    select * into v_expense from public.expenses where id = v_bill.expense_id for update;
    if v_expense.voided_at is null then
      if v_expense.cash_session_id is not null then
        v_session := public.current_cash_session_id();
        if v_session is null then raise exception 'NO_OPEN_SESSION' using errcode = 'P0001'; end if;
        insert into public.cash_transactions (cash_session_id, transaction_type, amount, reference_type, reference_id, note, user_id)
        values (v_session, 'DEPOSIT', v_expense.amount, 'expense_void', v_expense.id, 'ยกเลิก ' || v_bill.submission_number, auth.uid());
      end if;
      update public.expenses set voided_at = now(), void_reason = 'ยกเลิก ' || v_bill.submission_number || ': ' || trim(p_reason)
       where id = v_expense.id;
    end if;
  end if;

  if v_stock > 0 and coalesce(v_bill.paid_from_drawer, false) then
    v_session := coalesce(v_session, public.current_cash_session_id());
    if v_session is null then raise exception 'NO_OPEN_SESSION' using errcode = 'P0001'; end if;
    insert into public.cash_transactions (cash_session_id, transaction_type, amount, reference_type, reference_id, note, user_id)
    values (v_session, 'DEPOSIT', v_stock, 'bill_void', p_id, 'ยกเลิก ' || v_bill.submission_number, auth.uid());
  end if;

  update public.bill_submissions set voided_at = now(), void_reason = trim(p_reason), voided_by = auth.uid()
   where id = p_id returning * into v_bill;
  perform public.write_audit('VOID_BILL', 'bill_submissions', p_id, null, jsonb_build_object('reason', trim(p_reason), 'stock', v_stock));
  return v_bill;
end $$;

-- -----------------------------------------------------------------------------
-- Ledger and approval, updated
-- -----------------------------------------------------------------------------
create or replace view public.gl_lines as
with
cash_ledger as (
  select c.id, public.bkk_date(c.created_at) as d, c.transaction_type, c.amount, c.reference_type, c.note,
         case when c.transaction_type = 'OPENING' or c.reference_type = 'manual' then '1001' else '1190' end as contra,
         case
           when c.transaction_type = 'OPENING' or c.reference_type = 'manual' then null
           when c.reference_type in ('order', 'refund', 'order_cancel') then 'customers'
           when c.reference_type in ('purchase_order', 'bill_submission', 'bill_void') then 'suppliers'
           when c.reference_type in ('expense', 'expense_void') then 'expenses'
           else 'other_operating' end as cf
  from public.cash_transactions c
),
inv as (
  select i.*, public.bkk_date(i.created_at) as d, round(abs(i.total_cost), 2) as amt
  from public.inventory_transactions i
  where round(abs(i.total_cost), 2) <> 0
),
purchase_credit as (
  select i.id,
         case
           when i.reference_type = 'purchase_order' then
             case when exists (select 1 from public.cash_transactions c where c.reference_type = 'purchase_order'
                                 and c.reference_id = i.reference_id and c.created_at = i.created_at) then '1190' else '1010' end
           when i.reference_type = 'bill_submission' then
             (select public.payment_account(coalesce(b.paid_method, 'TRANSFER'), coalesce(b.paid_from_drawer, false))
                from public.bill_submissions b where b.id = i.reference_id)
           else '1010' end as account
  from inv i where i.transaction_type = 'PURCHASE'
),
lines as (
  -- drawer cash ledger
  select c.d, 'cash'::text as source_type, c.id as source_id, c.transaction_type::text as reference, c.note as memo,
         x.account, x.debit, x.credit, case when x.account = '1000' then c.cf end as cf_item, null::text as detail
  from cash_ledger c
  cross join lateral (values
    ('1000', greatest(c.amount, 0), greatest(-c.amount, 0)),
    (c.contra, greatest(-c.amount, 0), greatest(c.amount, 0))) as x(account, debit, credit)
  union all
  -- closing the drawer: counted cash goes to the safe; the difference is over/short
  select public.bkk_date(s.closed_at), 'cash_close', s.id, 'CLOSE', s.note, x.account, x.debit, x.credit, x.cf, null
  from public.cash_sessions s
  cross join lateral (values
    ('1001', s.actual_cash, 0::numeric, null::text),
    ('1000', 0::numeric, s.actual_cash, null::text),
    ('1000', greatest(s.variance, 0), greatest(-s.variance, 0), 'other_operating'),
    (case when s.variance >= 0 then '4900' else '5900' end, greatest(-s.variance, 0), greatest(s.variance, 0), null)) as x(account, debit, credit, cf)
  where s.status = 'CLOSED' and s.actual_cash is not null
  union all
  -- sales
  select o.business_date, 'order', o.id, o.order_number, null, x.account, x.debit, x.credit, null, null
  from public.orders o
  cross join lateral (values
    ('1190', o.total, 0::numeric),
    ('4000', 0::numeric, o.total - o.vat_amount),
    ('2200', 0::numeric, o.vat_amount)) as x(account, debit, credit)
  where o.status <> 'CANCELLED'
  union all
  -- non-cash receipts
  select o.business_date, 'payment', p.id, o.order_number, p.method::text, x.account, x.debit, x.credit, x.cf, null
  from public.payments p join public.orders o on o.id = p.order_id
  cross join lateral (values ('1010', p.amount, 0::numeric, 'customers'), ('1190', 0::numeric, p.amount, null)) as x(account, debit, credit, cf)
  where o.status <> 'CANCELLED' and p.method <> 'CASH'
  union all
  -- refunds: reverse revenue and VAT pro rata; non-drawer refunds leave the bank / safe
  select public.bkk_date(r.created_at), 'refund', r.id, r.refund_number, r.reason, x.account, x.debit, x.credit, x.cf, null
  from public.refunds r join public.orders o on o.id = r.order_id
  cross join lateral (select case when o.total > 0 then round(r.amount * o.vat_amount / o.total, 2) else 0 end as vat) v
  cross join lateral (values
    ('4010', r.amount - v.vat, 0::numeric, null::text),
    ('2200', v.vat, 0::numeric, null),
    ('1190', 0::numeric, r.amount, null),
    ('1190', case when r.cash_session_id is null then r.amount else 0 end, 0::numeric, null),
    (public.payment_account(r.method, false), 0::numeric, case when r.cash_session_id is null then r.amount else 0 end, 'customers'))
    as x(account, debit, credit, cf)
  union all
  -- stock ledger
  select i.d, 'inventory', i.id, i.transaction_type::text, i.note, x.account, x.debit, x.credit, x.cf, null
  from inv i
  left join purchase_credit pc on pc.id = i.id
  cross join lateral (values
    (case i.transaction_type
       when 'SALE' then '5000' when 'WASTE' then '5310' when 'PRODUCTION' then '5320'
       when 'ADJUSTMENT' then case when i.quantity > 0 then '3100' else '5300' end
       when 'RETURN' then '5000' when 'PURCHASE' then pc.account end,
     case when i.quantity < 0 then i.amt else 0 end,
     case when i.quantity > 0 then i.amt else 0 end,
     case when i.transaction_type = 'PURCHASE' and pc.account in ('1001', '1010') then 'suppliers' end),
    ('1200', case when i.quantity > 0 then i.amt else 0 end, case when i.quantity < 0 then i.amt else 0 end, null::text))
    as x(account, debit, credit, cf)
  union all
  -- operating expenses (and their voids)
  select e.expense_date, 'expense', e.id, e.category, e.description, x.account, x.debit, x.credit, x.cf, e.category
  from public.expenses e
  cross join lateral (select public.payment_account(e.payment_method, e.cash_session_id is not null) as pay) a
  cross join lateral (values
    ('6000', e.amount, 0::numeric, null::text),
    (a.pay, 0::numeric, e.amount, case when a.pay <> '1190' then 'expenses' end)) as x(account, debit, credit, cf)
  union all
  select public.bkk_date(e.voided_at), 'expense_void', e.id, e.category, e.void_reason, x.account, x.debit, x.credit, x.cf, e.category
  from public.expenses e
  cross join lateral (select public.payment_account(e.payment_method, e.cash_session_id is not null) as pay) a
  cross join lateral (values
    ('6000', 0::numeric, e.amount, null::text),
    (a.pay, e.amount, 0::numeric, case when a.pay <> '1190' then 'expenses' end)) as x(account, debit, credit, cf)
  where e.voided_at is not null
  union all
  -- voided bills: the stock part's payment comes back; the stock itself leaves through a
  -- 'bill_void' ADJUSTMENT at average cost (5300), so 5300 keeps only the cost difference
  select public.bkk_date(b.voided_at), 'bill_void', b.id, b.submission_number, b.void_reason, x.account, x.debit, x.credit, x.cf, null
  from public.bill_submissions b
  cross join lateral (select coalesce(sum((l ->> 'amount')::numeric), 0) as stock
                        from jsonb_array_elements(coalesce(b.approved_lines, '[]'::jsonb)) l
                       where nullif(l ->> 'ingredient_id', '') is not null) s
  cross join lateral (select public.payment_account(coalesce(b.paid_method, 'TRANSFER'), coalesce(b.paid_from_drawer, false)) as pay) a
  cross join lateral (values
    (a.pay, s.stock, 0::numeric, case when a.pay <> '1190' then 'suppliers' end),
    ('5300', 0::numeric, s.stock, null::text)) as x(account, debit, credit, cf)
  where b.voided_at is not null and b.status = 'APPROVED' and s.stock > 0
  union all
  -- manual journals
  select j.entry_date, 'journal', j.id, j.entry_number, coalesce(l.note, j.memo), l.account_code, l.debit, l.credit,
         case when a.is_cash then
           case when j.is_opening then 'opening'
                else coalesce((select case max(case oa.cash_flow when 'FINANCING' then 3 when 'INVESTING' then 2 else 1 end)
                                        when 3 then 'financing' when 2 then 'investing' when 1 then 'other_operating' end
                                 from public.journal_lines ol join public.accounts oa on oa.code = ol.account_code
                                where ol.entry_id = j.id and not oa.is_cash), null) end
         end,
         null
  from public.journal_lines l
  join public.journal_entries j on j.id = l.entry_id
  join public.accounts a on a.code = l.account_code
)
select d as entry_date, source_type, source_id, reference, memo, account as account_code, round(debit, 2) as debit, round(credit, 2) as credit,
       cf_item, detail
from lines
where debit <> 0 or credit <> 0;


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
         substitute_number = case when has_receipt then null else public.next_substitute_number() end,
         paid_method = p_payment_method, paid_from_drawer = p_from_drawer,
         approver_name = (select coalesce(nullif(trim(legal_name), ''), display_name) from public.employees where user_id = auth.uid()),
         payer_name = coalesce((select coalesce(nullif(trim(e.legal_name), ''), e.display_name) from public.employees e
                                 where e.id = bill_submissions.submitted_by), submitter_name),
         -- signatures are copied so an issued document never changes later
         payer_signature = (select s.image from public.employee_signatures s where s.employee_id = bill_submissions.submitted_by),
         approver_signature = (select s.image from public.employee_signatures s
                                 join public.employees e on e.id = s.employee_id where e.user_id = auth.uid())
   where id = p_id
  returning * into v_bill;
  perform public.write_audit('APPROVE_BILL', 'bill_submissions', p_id, null,
    jsonb_build_object('lines', p_lines, 'stock', v_stock_total, 'expense', v_expense_total, 'from_drawer', p_from_drawer));
  return v_bill;
end $$;

revoke all on public.gl_lines from public, anon, authenticated;

revoke execute on function public.telegram_add_attachment(bigint, text, text) from public, anon, authenticated;
grant execute on function public.telegram_add_attachment(bigint, text, text), public.set_attachment_drive_url(uuid, text) to service_role;
grant execute on function public.set_attachment_drive_url(uuid, text), public.add_bill_attachment(uuid, text, text), public.edit_substitute(uuid, date, text, text, jsonb),
  public.void_bill(uuid, text) to authenticated;

-- =============================================================================
-- Phase 15: Accounting — chart of accounts, a double-entry general ledger derived
-- from the existing source documents, manual journals (opening balances,
-- equipment, loans, owner capital/drawings), and statements: profit & loss,
-- balance sheet and cash flow. Also e-signatures for the substitute receipt.
--
-- The ledger is a VIEW over append-only sources (orders, payments, refunds, the
-- stock and cash ledgers, expenses, cash sessions, approved bills) plus manual
-- journal lines, so it is always consistent with operations and covers history.
-- Every source row produces balanced lines. Drawer cash moves through the clearing
-- account 1190: the cash ledger posts drawer ↔ 1190 and documents post 1190 ↔
-- revenue/expense/stock, so the two halves net to zero per document.
-- Mapping assumptions (documented in docs/ACCOUNTING.md):
--   * non-cash receipts/payments (QR, transfer, card) → 1010 bank
--   * cash paid outside the drawer → 1001 cash on hand (safe / owner's float)
--   * purchase orders received without paying from the drawer → 1010 bank
--   * positive stock adjustments → 3100 opening stock (equity), as in report_pnl
-- =============================================================================

create type public.account_type as enum ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
create type public.cash_flow_class as enum ('OPERATING', 'INVESTING', 'FINANCING');

create table public.accounts (
  code text primary key check (code ~ '^[0-9]{4}$'),
  name_th text not null,
  name_en text not null,
  account_type public.account_type not null,
  is_cash boolean not null default false,
  -- how a cash movement against this account is classified in the cash-flow statement
  cash_flow public.cash_flow_class not null default 'OPERATING',
  sort_order integer not null default 0
);

insert into public.accounts (code, name_th, name_en, account_type, is_cash, cash_flow) values
  ('1000', 'เงินสดในลิ้นชัก', 'Cash in drawer', 'ASSET', true, 'OPERATING'),
  ('1001', 'เงินสดนอกลิ้นชัก / เงินสดย่อย', 'Cash on hand (safe)', 'ASSET', true, 'OPERATING'),
  ('1010', 'เงินฝากธนาคาร / พร้อมเพย์', 'Bank / PromptPay', 'ASSET', true, 'OPERATING'),
  ('1190', 'เงินรอตัดบัญชี', 'Clearing', 'ASSET', false, 'OPERATING'),
  ('1200', 'สินค้าคงเหลือ', 'Inventory', 'ASSET', false, 'OPERATING'),
  ('1300', 'ภาษีซื้อ', 'Input VAT', 'ASSET', false, 'OPERATING'),
  ('1400', 'เงินมัดจำและลูกหนี้อื่น', 'Deposits & other receivables', 'ASSET', false, 'OPERATING'),
  ('1500', 'อุปกรณ์และสินทรัพย์ถาวร', 'Equipment & fixed assets', 'ASSET', false, 'INVESTING'),
  ('1510', 'ค่าเสื่อมราคาสะสม', 'Accumulated depreciation', 'ASSET', false, 'INVESTING'),
  ('2000', 'เจ้าหนี้การค้า', 'Accounts payable', 'LIABILITY', false, 'OPERATING'),
  ('2100', 'เงินกู้ยืม', 'Loans', 'LIABILITY', false, 'FINANCING'),
  ('2200', 'ภาษีขาย', 'Output VAT', 'LIABILITY', false, 'OPERATING'),
  ('2300', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', 'Withholding tax payable', 'LIABILITY', false, 'OPERATING'),
  ('2400', 'ค่าใช้จ่ายค้างจ่าย', 'Accrued expenses', 'LIABILITY', false, 'OPERATING'),
  ('3000', 'ทุน', 'Owner''s capital', 'EQUITY', false, 'FINANCING'),
  ('3100', 'ปรับปรุงสินค้ายกมา', 'Opening stock contributed', 'EQUITY', false, 'FINANCING'),
  ('3200', 'ถอนใช้ส่วนตัว / เงินปันผล', 'Owner''s drawings', 'EQUITY', false, 'FINANCING'),
  ('3300', 'กำไรสะสมยกมา', 'Retained earnings brought forward', 'EQUITY', false, 'FINANCING'),
  ('4000', 'รายได้จากการขาย', 'Sales', 'REVENUE', false, 'OPERATING'),
  ('4010', 'รับคืนสินค้า / คืนเงิน', 'Sales returns & refunds', 'REVENUE', false, 'OPERATING'),
  ('4900', 'รายได้อื่น / เงินสดเกิน', 'Other income / cash over', 'REVENUE', false, 'OPERATING'),
  ('5000', 'ต้นทุนขาย', 'Cost of goods sold', 'EXPENSE', false, 'OPERATING'),
  ('5300', 'สินค้าขาด / ปรับปรุงสต็อก', 'Stock shrinkage', 'EXPENSE', false, 'OPERATING'),
  ('5310', 'ของเสีย', 'Waste', 'EXPENSE', false, 'OPERATING'),
  ('5320', 'ผลต่างการผลิต', 'Production variance', 'EXPENSE', false, 'OPERATING'),
  ('5900', 'เงินสดขาด', 'Cash short', 'EXPENSE', false, 'OPERATING'),
  ('6000', 'ค่าใช้จ่ายในการดำเนินงาน', 'Operating expenses', 'EXPENSE', false, 'OPERATING'),
  ('6100', 'ค่าเสื่อมราคา', 'Depreciation', 'EXPENSE', false, 'OPERATING'),
  ('6900', 'ค่าใช้จ่ายอื่น', 'Other expenses', 'EXPENSE', false, 'OPERATING');
update public.accounts set sort_order = code::integer;

alter table public.accounts enable row level security;
create policy accounts_read on public.accounts for select to authenticated using (public.is_staff());
grant select on public.accounts to authenticated;

-- -----------------------------------------------------------------------------
-- Manual journals (OWNER): opening balances, equipment, loans, capital, drawings,
-- depreciation, corrections. Append-only; a mistake is fixed with a reversing entry.
-- -----------------------------------------------------------------------------
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  entry_number text not null unique,
  entry_date date not null,
  memo text not null check (length(trim(memo)) between 1 and 300),
  is_opening boolean not null default false,
  reverses uuid references public.journal_entries (id),
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);
create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.journal_entries (id),
  account_code text not null references public.accounts (code),
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  note text,
  constraint one_side check ((debit = 0) <> (credit = 0))
);
create index journal_lines_entry_idx on public.journal_lines (entry_id);
create trigger journal_entries_immutable before update or delete on public.journal_entries
  for each row execute function public.prevent_mutation();
create trigger journal_lines_immutable before update or delete on public.journal_lines
  for each row execute function public.prevent_mutation();
create trigger journal_entries_audit after insert on public.journal_entries
  for each row execute function public.audit_row_change();

alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
create policy journal_entries_read on public.journal_entries for select to authenticated using (public.has_role('OWNER', 'MANAGER'));
create policy journal_lines_read on public.journal_lines for select to authenticated using (public.has_role('OWNER', 'MANAGER'));
grant select on public.journal_entries, public.journal_lines to authenticated;

-- p_lines: [{account_code, debit, credit, note?}] — must balance, at least two lines.
create or replace function public.post_journal(p_entry_date date, p_memo text, p_lines jsonb, p_is_opening boolean default false)
returns public.journal_entries
language plpgsql security definer set search_path = public
as $$
declare
  v_entry public.journal_entries;
  v_line jsonb;
  v_dr numeric := 0;
  v_cr numeric := 0;
  v_d numeric;
  v_c numeric;
begin
  perform public.require_role('OWNER');
  if p_entry_date is null then raise exception 'VALIDATION: date is required' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'VALIDATION: a journal needs at least two lines' using errcode = 'P0001';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_d := coalesce((v_line ->> 'debit')::numeric, 0);
    v_c := coalesce((v_line ->> 'credit')::numeric, 0);
    if v_d < 0 or v_c < 0 or round(v_d, 2) <> v_d or round(v_c, 2) <> v_c or (v_d = 0) = (v_c = 0) then
      raise exception 'VALIDATION: each line needs either a debit or a credit (>= 0, 2 decimals)' using errcode = 'P0001';
    end if;
    if v_line ->> 'account_code' in ('1190') then
      raise exception 'VALIDATION: account 1190 is managed by the system' using errcode = 'P0001';
    end if;
    v_dr := v_dr + v_d;
    v_cr := v_cr + v_c;
  end loop;
  if v_dr <> v_cr then raise exception 'VALIDATION: debits (%) must equal credits (%)', v_dr, v_cr using errcode = 'P0001'; end if;
  insert into public.journal_entries (entry_number, entry_date, memo, is_opening, created_by)
  values (public.next_document_number('JV', 'public.journal_entries', 'entry_number'), p_entry_date, trim(p_memo), coalesce(p_is_opening, false), auth.uid())
  returning * into v_entry;
  insert into public.journal_lines (entry_id, account_code, debit, credit, note)
  select v_entry.id, l ->> 'account_code', coalesce((l ->> 'debit')::numeric, 0), coalesce((l ->> 'credit')::numeric, 0), nullif(trim(l ->> 'note'), '')
  from jsonb_array_elements(p_lines) l;
  return v_entry;
end $$;

create or replace function public.reverse_journal(p_id uuid, p_entry_date date default null)
returns public.journal_entries
language plpgsql security definer set search_path = public
as $$
declare
  v_src public.journal_entries;
  v_entry public.journal_entries;
begin
  perform public.require_role('OWNER');
  select * into v_src from public.journal_entries where id = p_id;
  if not found then raise exception 'NOT_FOUND: journal' using errcode = 'P0001'; end if;
  if exists (select 1 from public.journal_entries where reverses = p_id) then
    raise exception 'INVALID_STATE: already reversed' using errcode = 'P0001';
  end if;
  insert into public.journal_entries (entry_number, entry_date, memo, reverses, created_by)
  values (public.next_document_number('JV', 'public.journal_entries', 'entry_number'), coalesce(p_entry_date, public.bkk_date(now())),
          left('กลับรายการ ' || v_src.entry_number || ': ' || v_src.memo, 300), p_id, auth.uid())
  returning * into v_entry;
  insert into public.journal_lines (entry_id, account_code, debit, credit, note)
  select v_entry.id, account_code, credit, debit, note from public.journal_lines where entry_id = p_id;
  return v_entry;
end $$;

-- -----------------------------------------------------------------------------
-- Bills: how they were paid (for the ledger) and signatures on the substitute receipt
-- -----------------------------------------------------------------------------
create table public.employee_signatures (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  image text not null check (image ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' and length(image) <= 200000),
  updated_at timestamptz not null default now()
);
alter table public.employee_signatures enable row level security;
create policy employee_signatures_read on public.employee_signatures for select to authenticated
  using (public.has_role('OWNER', 'MANAGER') or employee_id in (select id from public.employees where user_id = auth.uid()));
grant select on public.employee_signatures to authenticated;

-- Any active employee saves (or clears, with null) their own signature.
create or replace function public.save_my_signature(p_image text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_employee uuid;
begin
  select id into v_employee from public.employees where user_id = auth.uid() and is_active;
  if v_employee is null then raise exception 'permission denied: not an employee' using errcode = '42501'; end if;
  if p_image is null then
    delete from public.employee_signatures where employee_id = v_employee;
  else
    insert into public.employee_signatures (employee_id, image) values (v_employee, p_image)
    on conflict (employee_id) do update set image = excluded.image, updated_at = now();
  end if;
end $$;

alter table public.bill_submissions
  add column paid_method public.payment_method,
  add column paid_from_drawer boolean,
  add column approver_name text,
  add column payer_signature text,
  add column approver_signature text;

-- Bills approved before this migration: drawer if a withdrawal/expense hit the drawer, else the expense's method.
update public.bill_submissions b
   set paid_from_drawer = exists (select 1 from public.cash_transactions c where c.reference_id in (b.id, b.expense_id)),
       paid_method = coalesce((select e.payment_method from public.expenses e where e.id = b.expense_id), 'TRANSFER'),
       approver_name = (select display_name from public.employees where user_id = b.reviewed_by)
 where b.status = 'APPROVED';


-- -----------------------------------------------------------------------------
-- General ledger
-- -----------------------------------------------------------------------------
-- Account a payment leaves from / arrives in. Drawer payments go through clearing (1190),
-- whose other half is the cash-ledger row.
create or replace function public.payment_account(p_method public.payment_method, p_drawer boolean)
returns text language sql immutable as $$
  select case when p_drawer then '1190' when p_method = 'CASH' then '1001' else '1010' end
$$;

-- One row per ledger line. cf_item classifies lines on cash accounts for the cash-flow
-- statement: customers, suppliers, expenses, other_operating, investing, financing,
-- opening (opening balances) or null (moves between cash accounts).
create or replace view public.gl_lines as
with
cash_ledger as (
  select c.id, public.bkk_date(c.created_at) as d, c.transaction_type, c.amount, c.reference_type, c.note,
         case when c.transaction_type = 'OPENING' or c.reference_type = 'manual' then '1001' else '1190' end as contra,
         case
           when c.transaction_type = 'OPENING' or c.reference_type = 'manual' then null
           when c.reference_type in ('order', 'refund', 'order_cancel') then 'customers'
           when c.reference_type in ('purchase_order', 'bill_submission') then 'suppliers'
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

revoke all on public.gl_lines from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Statements (OWNER / MANAGER)
-- -----------------------------------------------------------------------------
create or replace function public.report_trial_balance(p_as_of date)
returns table (account_code text, name_th text, name_en text, account_type public.account_type, debit numeric, credit numeric, balance numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_role('OWNER', 'MANAGER');
  return query
    select a.code, a.name_th, a.name_en, a.account_type,
           coalesce(sum(g.debit), 0), coalesce(sum(g.credit), 0), coalesce(sum(g.debit - g.credit), 0)
    from public.accounts a
    left join public.gl_lines g on g.account_code = a.code and g.entry_date <= p_as_of
    group by a.code
    order by a.sort_order;
end $$;

-- Balances as of a date. Earnings to date (revenue − expenses, all periods) are shown
-- inside equity so that assets = liabilities + equity.
create or replace function public.report_balance_sheet(p_as_of date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_rows jsonb;
  v_assets numeric;
  v_liabilities numeric;
  v_equity numeric;
  v_earnings numeric;
begin
  perform public.require_role('OWNER', 'MANAGER');
  if p_as_of is null then raise exception 'VALIDATION: date is required' using errcode = 'P0001'; end if;
  with b as (
    select a.code, a.name_th, a.name_en, a.account_type, a.sort_order,
           coalesce(sum(g.debit - g.credit), 0) as dr_balance
    from public.accounts a
    left join public.gl_lines g on g.account_code = a.code and g.entry_date <= p_as_of
    group by a.code
  )
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name_th', name_th, 'name_en', name_en, 'type', account_type,
           'amount', case when account_type = 'ASSET' then dr_balance else -dr_balance end) order by sort_order)
           filter (where account_type in ('ASSET', 'LIABILITY', 'EQUITY') and dr_balance <> 0), '[]'::jsonb),
         coalesce(sum(dr_balance) filter (where account_type = 'ASSET'), 0),
         coalesce(-sum(dr_balance) filter (where account_type = 'LIABILITY'), 0),
         coalesce(-sum(dr_balance) filter (where account_type = 'EQUITY'), 0),
         coalesce(-sum(dr_balance) filter (where account_type in ('REVENUE', 'EXPENSE')), 0)
    into v_rows, v_assets, v_liabilities, v_equity, v_earnings
  from b;
  return jsonb_build_object(
    'as_of', p_as_of, 'lines', v_rows,
    'total_assets', round(v_assets, 2), 'total_liabilities', round(v_liabilities, 2),
    'equity_accounts', round(v_equity, 2), 'earnings_to_date', round(v_earnings, 2),
    'total_equity', round(v_equity + v_earnings, 2),
    'difference', round(v_assets - v_liabilities - v_equity - v_earnings, 2));
end $$;

-- Profit & loss from the ledger for a period, expenses broken down by category.
create or replace function public.report_gl_pnl(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_lines jsonb;
  v_exp jsonb;
  v_revenue numeric;
  v_cogs numeric;
  v_other_cost numeric;
  v_opex numeric;
begin
  perform public.require_report_range(p_from, p_to);
  with p as (
    select a.code, a.name_th, a.name_en, a.account_type, a.sort_order,
           coalesce(sum(case when a.account_type = 'REVENUE' then g.credit - g.debit else g.debit - g.credit end), 0) as amount
    from public.accounts a
    left join public.gl_lines g on g.account_code = a.code and g.entry_date between p_from and p_to
    where a.account_type in ('REVENUE', 'EXPENSE')
    group by a.code
  )
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name_th', name_th, 'name_en', name_en, 'type', account_type, 'amount', amount)
                    order by sort_order) filter (where amount <> 0), '[]'::jsonb),
         coalesce(sum(amount) filter (where account_type = 'REVENUE'), 0),
         coalesce(sum(amount) filter (where code = '5000'), 0),
         coalesce(sum(amount) filter (where account_type = 'EXPENSE' and code like '5%' and code <> '5000'), 0),
         coalesce(sum(amount) filter (where account_type = 'EXPENSE' and code like '6%'), 0)
    into v_lines, v_revenue, v_cogs, v_other_cost, v_opex
  from p;
  select coalesce(jsonb_agg(jsonb_build_object('category', detail, 'amount', amount) order by amount desc), '[]'::jsonb)
    into v_exp
  from (select coalesce(detail, 'อื่น ๆ') as detail, sum(debit - credit) as amount
        from public.gl_lines where account_code = '6000' and entry_date between p_from and p_to
        group by 1 having sum(debit - credit) <> 0) e;
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'lines', v_lines, 'expense_categories', v_exp,
    'revenue', round(v_revenue, 2), 'cogs', round(v_cogs, 2), 'gross_profit', round(v_revenue - v_cogs, 2),
    'other_costs', round(v_other_cost, 2), 'operating_expenses', round(v_opex, 2),
    'net_profit', round(v_revenue - v_cogs - v_other_cost - v_opex, 2));
end $$;

-- Direct-method cash flow over the cash accounts (1000, 1001, 1010).
create or replace function public.report_cash_flow(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_opening numeric;
  v_closing numeric;
  v_items jsonb;
  v_by_account jsonb;
begin
  perform public.require_report_range(p_from, p_to);
  select coalesce(sum(g.debit - g.credit), 0) into v_opening
  from public.gl_lines g join public.accounts a on a.code = g.account_code
  where a.is_cash and (g.entry_date < p_from or (g.entry_date between p_from and p_to and g.cf_item = 'opening'));
  select coalesce(sum(g.debit - g.credit), 0) into v_closing
  from public.gl_lines g join public.accounts a on a.code = g.account_code
  where a.is_cash and g.entry_date <= p_to;
  select coalesce(jsonb_object_agg(item, amount), '{}'::jsonb) into v_items
  from (select g.cf_item as item, round(sum(g.debit - g.credit), 2) as amount
        from public.gl_lines g join public.accounts a on a.code = g.account_code
        where a.is_cash and g.entry_date between p_from and p_to and g.cf_item is not null and g.cf_item <> 'opening'
        group by g.cf_item) x;
  select coalesce(jsonb_agg(jsonb_build_object('code', a.code, 'name_th', a.name_th, 'name_en', a.name_en,
           'balance', (select coalesce(sum(debit - credit), 0) from public.gl_lines g where g.account_code = a.code and g.entry_date <= p_to))
           order by a.sort_order), '[]'::jsonb)
    into v_by_account
  from public.accounts a where a.is_cash;
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'opening_cash', round(v_opening, 2), 'closing_cash', round(v_closing, 2),
    'items', v_items, 'closing_by_account', v_by_account,
    'operating', round(coalesce((v_items ->> 'customers')::numeric, 0) + coalesce((v_items ->> 'suppliers')::numeric, 0)
                     + coalesce((v_items ->> 'expenses')::numeric, 0) + coalesce((v_items ->> 'other_operating')::numeric, 0), 2),
    'investing', round(coalesce((v_items ->> 'investing')::numeric, 0), 2),
    'financing', round(coalesce((v_items ->> 'financing')::numeric, 0), 2));
end $$;

-- Ledger lines for one account (drill-down), newest last.
create or replace function public.report_account_ledger(p_account text, p_from date, p_to date)
returns table (entry_date date, source_type text, reference text, memo text, debit numeric, credit numeric, running_balance numeric)
language plpgsql stable security definer set search_path = public
as $$
declare v_opening numeric;
begin
  perform public.require_report_range(p_from, p_to);
  select coalesce(sum(g.debit - g.credit), 0) into v_opening from public.gl_lines g where g.account_code = p_account and g.entry_date < p_from;
  return query
    select g.entry_date, g.source_type, g.reference, g.memo, g.debit, g.credit,
           v_opening + sum(g.debit - g.credit) over (order by g.entry_date, g.source_type, g.reference rows unbounded preceding)
    from public.gl_lines g
    where g.account_code = p_account and g.entry_date between p_from and p_to
    order by g.entry_date, g.source_type, g.reference;
end $$;

grant execute on function
  public.post_journal(date, text, jsonb, boolean), public.reverse_journal(uuid, date), public.save_my_signature(text),
  public.report_trial_balance(date), public.report_balance_sheet(date), public.report_gl_pnl(date, date),
  public.report_cash_flow(date, date), public.report_account_ledger(text, date, date)
to authenticated;

-- Approval also records how the bill was paid, the approver and both signatures.
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
         approver_name = (select display_name from public.employees where user_id = auth.uid()),
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
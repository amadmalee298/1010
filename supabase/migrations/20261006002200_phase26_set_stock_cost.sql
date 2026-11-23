-- Phase 26: fewer steps for setting stock and its price.
--  * set_stock_cost(): one call sets the quantity on hand and its unit cost ('cost_reset' movements).
--  * gl_lines / report_pnl: 'cost_reset' movements go to 3100 opening stock both ways, never shrinkage.

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
       when 'ADJUSTMENT' then case when i.quantity > 0 or i.reference_type = 'cost_reset' then '3100' else '5300' end
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

create or replace function public.report_pnl(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_sales jsonb;
  v_waste numeric;
  v_shrink numeric;
  v_exp jsonb;
  v_exp_total numeric;
  v_net_sales numeric;
  v_cogs numeric;
  v_from timestamptz := (p_from::timestamp at time zone 'Asia/Bangkok');
  v_to timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Bangkok');
begin
  perform public.require_report_range(p_from, p_to);
  v_sales := public.report_sales(p_from, p_to) -> 'summary';
  v_net_sales := (v_sales ->> 'net_sales')::numeric;
  v_cogs := (v_sales ->> 'cogs')::numeric;
  select coalesce(-sum(total_cost), 0) into v_waste from public.inventory_transactions
   where transaction_type = 'WASTE' and created_at >= v_from and created_at < v_to;
  select coalesce(-sum(total_cost), 0) into v_shrink from public.inventory_transactions
   where transaction_type = 'ADJUSTMENT' and quantity < 0 and coalesce(reference_type, '') <> 'cost_reset'
     and created_at >= v_from and created_at < v_to;
  -- Journals that move amounts out of (or into) 5300 shrinkage — e.g. set-up stock corrections moved
  -- to opening stock — apply here too, so this P&L agrees with the accounting statements.
  v_shrink := v_shrink - (select coalesce(sum(l.credit - l.debit), 0)
                            from public.journal_lines l join public.journal_entries j on j.id = l.entry_id
                           where l.account_code = '5300' and j.entry_date between p_from and p_to);
  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', amount) order by amount desc), '[]'::jsonb),
         coalesce(sum(amount), 0)
    into v_exp, v_exp_total
  from (select category, sum(amount) as amount from public.expenses
        where voided_at is null and expense_date between p_from and p_to group by category) e;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'gross_sales', v_sales -> 'gross_sales',
    'discounts', v_sales -> 'discounts',
    'refunds', v_sales -> 'refunds',
    'vat', v_sales -> 'vat',
    'net_sales', v_net_sales,
    'cogs', v_cogs,
    'gross_profit', v_net_sales - v_cogs,
    'gross_margin', case when v_net_sales > 0 then round((v_net_sales - v_cogs) / v_net_sales, 4) end,
    'waste', round(v_waste, 2),
    'shrinkage', round(v_shrink, 2),
    'expenses', v_exp,
    'expenses_total', v_exp_total,
    'net_profit', round(v_net_sales - v_cogs - v_waste - v_shrink - v_exp_total, 2),
    'net_margin', case when v_net_sales > 0 then round((v_net_sales - v_cogs - v_waste - v_shrink - v_exp_total) / v_net_sales, 4) end
  );
end $$;

-- Set what is on hand and its price in one step (e.g. "eggs: 150 left, 4 THB each").
-- Existing stock is taken out and the counted quantity put back at the new cost, so the average
-- cost becomes exactly p_unit_cost. Both movements are 'cost_reset' and post to 3100 opening stock,
-- never to 5300 shrinkage: this is a correction of the set-up, not a loss.
create or replace function public.set_stock_cost(
  p_ingredient_id uuid, p_quantity numeric, p_unit_cost numeric, p_note text default null
) returns public.ingredients
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.ingredients;
  v_note text := coalesce(nullif(trim(p_note), ''), 'ตั้งยอดและต้นทุน');
begin
  perform public.require_role('OWNER', 'MANAGER');
  if p_quantity is null or p_quantity < 0 then
    raise exception 'VALIDATION: quantity must be >= 0' using errcode = 'P0001';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'VALIDATION: unit cost must be >= 0' using errcode = 'P0001';
  end if;
  select * into v_item from public.ingredients where id = p_ingredient_id for update;
  if not found then raise exception 'NOT_FOUND: ingredient' using errcode = 'P0001'; end if;

  if v_item.stock_qty > 0 then
    perform public.post_inventory(p_ingredient_id, 'ADJUSTMENT', -v_item.stock_qty, null, 'cost_reset', null, v_note);
  elsif v_item.stock_qty < 0 then
    perform public.post_inventory(p_ingredient_id, 'ADJUSTMENT', -v_item.stock_qty, v_item.avg_cost, 'cost_reset', null, v_note);
  end if;
  if p_quantity > 0 then
    perform public.post_inventory(p_ingredient_id, 'ADJUSTMENT', p_quantity, p_unit_cost, 'cost_reset', null, v_note);
  end if;

  select * into v_item from public.ingredients where id = p_ingredient_id;
  perform public.write_audit('SET_STOCK_COST', 'ingredients', p_ingredient_id, null,
    jsonb_build_object('quantity', p_quantity, 'unit_cost', p_unit_cost, 'note', v_note));
  return v_item;
end $$;
revoke execute on function public.set_stock_cost(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.set_stock_cost(uuid, numeric, numeric, text) to authenticated;

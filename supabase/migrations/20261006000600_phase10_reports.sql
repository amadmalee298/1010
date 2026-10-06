-- =============================================================================
-- Phase 10: Dashboard, reports, Profit & Loss, menu profitability
--
-- Definitions (also documented in docs/REPORTING.md):
--   gross_sales   = Σ order subtotal (list price × qty)
--   discounts     = Σ promotion + manual + points discounts
--   net_sales     = Σ (order total − VAT) − refunds ex-VAT        (excludes cancelled orders)
--   cogs          = Σ order COGS − Σ refund COGS returned to stock
--   gross_profit  = net_sales − cogs
--   net_profit    = gross_profit − waste − stock shrinkage − operating expenses
-- All date ranges are inclusive Bangkok calendar dates (orders.business_date).
-- =============================================================================

create or replace function public.require_report_range(p_from date, p_to date)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_role('OWNER', 'MANAGER');
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'VALIDATION: invalid date range (max 366 days)' using errcode = 'P0001';
  end if;
end $$;
revoke execute on function public.require_report_range(date, date) from public, anon, authenticated;

-- Per-order net figures (ex VAT), refunds allocated pro-rata.
create or replace view public.order_financials with (security_invoker = true) as
select
  o.id, o.business_date, o.created_at, o.created_by, o.order_type, o.status, o.customer_id,
  o.subtotal, o.promotion_discount + o.manual_discount + o.points_discount as discounts,
  o.vat_amount, o.total, o.refunded_total,
  case when o.total > 0 then round(o.refunded_total * (o.total - o.vat_amount) / o.total, 2) else 0 end as refunds_ex_vat,
  o.total - o.vat_amount as sales_ex_vat,
  o.cogs_total,
  coalesce((select sum(r.cogs_reversed) from public.refunds r where r.order_id = o.id), 0) as cogs_reversed
from public.orders o
where o.status <> 'CANCELLED';

create or replace function public.report_sales(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v jsonb;
begin
  perform public.require_report_range(p_from, p_to);
  with f as (select * from public.order_financials where business_date between p_from and p_to)
  select jsonb_build_object(
    'summary', (select jsonb_build_object(
        'orders', count(*),
        'gross_sales', coalesce(sum(subtotal), 0),
        'discounts', coalesce(sum(discounts), 0),
        'vat', coalesce(sum(vat_amount), 0),
        'refunds', coalesce(sum(refunded_total), 0),
        'net_sales', coalesce(sum(sales_ex_vat - refunds_ex_vat), 0),
        'cogs', coalesce(sum(cogs_total - cogs_reversed), 0),
        'avg_ticket', case when count(*) > 0 then round(sum(total) / count(*), 2) else 0 end,
        'cancelled', (select count(*) from public.orders where business_date between p_from and p_to and status = 'CANCELLED'))
      from f),
    'by_day', coalesce((select jsonb_agg(d order by d.day) from (
        select gs::date as day,
               coalesce((select sum(sales_ex_vat - refunds_ex_vat) from f where business_date = gs::date), 0) as net_sales,
               coalesce((select sum(cogs_total - cogs_reversed) from f where business_date = gs::date), 0) as cogs,
               (select count(*) from f where business_date = gs::date) as orders
        from generate_series(p_from, p_to, interval '1 day') gs) d), '[]'::jsonb),
    'by_hour', coalesce((select jsonb_agg(h order by h.hour) from (
        select extract(hour from created_at at time zone 'Asia/Bangkok')::int as hour, count(*) as orders,
               sum(sales_ex_vat - refunds_ex_vat) as net_sales
        from f group by 1) h), '[]'::jsonb),
    'by_payment', coalesce((select jsonb_agg(p order by p.amount desc) from (
        select pm.method, count(distinct pm.order_id) as orders, sum(pm.amount) as amount
        from public.payments pm join f on f.id = pm.order_id group by pm.method) p), '[]'::jsonb),
    'by_order_type', coalesce((select jsonb_agg(t) from (
        select order_type, count(*) as orders, sum(sales_ex_vat - refunds_ex_vat) as net_sales from f group by order_type) t), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- Per-product performance and menu profitability.
create or replace function public.report_products(p_from date, p_to date)
returns table (product_id uuid, product_name text, category_name text, quantity bigint, net_sales numeric,
               cogs numeric, gross_profit numeric, gross_margin numeric, share_of_sales numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_report_range(p_from, p_to);
  return query
  with lines as (
    select oi.product_id, oi.product_name,
           (oi.quantity - oi.refunded_quantity) as qty,
           case when o.subtotal > 0
             then oi.line_total * (oi.quantity - oi.refunded_quantity) / oi.quantity * (o.total - o.vat_amount) / o.subtotal
             else 0 end as net,
           oi.cogs_total * (oi.quantity - oi.refunded_quantity) / oi.quantity as cost
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.status <> 'CANCELLED' and o.business_date between p_from and p_to
  ), agg as (
    select l.product_id, max(l.product_name) as product_name, sum(l.qty)::bigint as qty,
           round(sum(l.net), 2) as net, round(sum(l.cost), 2) as cost
    from lines l group by l.product_id
  )
  select a.product_id, a.product_name, c.name_th, a.qty, a.net, a.cost, a.net - a.cost,
         case when a.net > 0 then round((a.net - a.cost) / a.net, 4) end,
         case when sum(a.net) over () > 0 then round(a.net / sum(a.net) over (), 4) end
  from agg a
  left join public.products p on p.id = a.product_id
  left join public.categories c on c.id = p.category_id
  order by a.net desc;
end $$;

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
   where transaction_type = 'ADJUSTMENT' and quantity < 0 and created_at >= v_from and created_at < v_to;
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

-- Inventory movement summary for a period, per item.
create or replace function public.report_inventory(p_from date, p_to date)
returns table (ingredient_id uuid, name_th text, unit text, item_type public.item_type, purchased numeric, produced numeric,
               sold numeric, consumed_in_production numeric, wasted numeric, adjusted numeric, returned numeric,
               stock_qty numeric, stock_value numeric)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_from timestamptz := (p_from::timestamp at time zone 'Asia/Bangkok');
  v_to timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Bangkok');
begin
  perform public.require_report_range(p_from, p_to);
  return query
  select i.id, i.name_th, i.unit, i.item_type,
    coalesce(sum(t.quantity) filter (where t.transaction_type = 'PURCHASE'), 0),
    coalesce(sum(t.quantity) filter (where t.transaction_type = 'PRODUCTION' and t.quantity > 0), 0),
    coalesce(-sum(t.quantity) filter (where t.transaction_type = 'SALE'), 0),
    coalesce(-sum(t.quantity) filter (where t.transaction_type = 'PRODUCTION' and t.quantity < 0), 0),
    coalesce(-sum(t.quantity) filter (where t.transaction_type = 'WASTE'), 0),
    coalesce(sum(t.quantity) filter (where t.transaction_type = 'ADJUSTMENT'), 0),
    coalesce(sum(t.quantity) filter (where t.transaction_type = 'RETURN'), 0),
    i.stock_qty, round(greatest(i.stock_qty, 0) * i.avg_cost, 2)
  from public.ingredients i
  left join public.inventory_transactions t on t.ingredient_id = i.id and t.created_at >= v_from and t.created_at < v_to
  where i.is_active
  group by i.id
  order by i.item_type, i.name_th;
end $$;

create or replace function public.report_purchases(p_from date, p_to date)
returns table (supplier_id uuid, supplier_name text, orders bigint, received_value numeric)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_from timestamptz := (p_from::timestamp at time zone 'Asia/Bangkok');
  v_to timestamptz := ((p_to + 1)::timestamp at time zone 'Asia/Bangkok');
begin
  perform public.require_report_range(p_from, p_to);
  return query
  select s.id, s.name, count(distinct t.reference_id), round(coalesce(sum(t.total_cost), 0), 2)
  from public.inventory_transactions t
  join public.purchase_orders po on po.id = t.reference_id
  join public.suppliers s on s.id = po.supplier_id
  where t.transaction_type = 'PURCHASE' and t.created_at >= v_from and t.created_at < v_to
  group by s.id order by 4 desc;
end $$;

create or replace function public.report_production(p_from date, p_to date)
returns table (product_id uuid, product_name text, runs bigint, planned_output numeric, actual_output numeric,
               total_cost numeric, avg_unit_cost numeric, yield_rate numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_report_range(p_from, p_to);
  return query
  select p.id, p.name_th, count(*), sum(pr.planned_output), sum(pr.actual_output), sum(pr.total_cost),
         case when sum(pr.actual_output) > 0 then round(sum(pr.total_cost) / sum(pr.actual_output), 4) end,
         case when sum(pr.planned_output) > 0 then round(sum(pr.actual_output) / sum(pr.planned_output), 4) end
  from public.production pr join public.products p on p.id = pr.product_id
  where pr.status = 'COMPLETED' and public.bkk_date(pr.completed_at) between p_from and p_to
  group by p.id order by 6 desc;
end $$;

create or replace function public.report_expenses(p_from date, p_to date)
returns table (category text, entries bigint, amount numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_report_range(p_from, p_to);
  return query
  select e.category, count(*), sum(e.amount) from public.expenses e
  where e.voided_at is null and e.expense_date between p_from and p_to
  group by e.category order by 3 desc;
end $$;

create or replace function public.report_cash(p_from date, p_to date)
returns setof public.cash_session_summary
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_report_range(p_from, p_to);
  return query select * from public.cash_session_summary s
   where public.bkk_date(s.opened_at) between p_from and p_to order by s.opened_at;
end $$;

create or replace function public.report_employee_sales(p_from date, p_to date)
returns table (user_id uuid, employee_name text, orders bigint, net_sales numeric, avg_ticket numeric, refunds numeric)
language plpgsql stable security definer set search_path = public
as $$
begin
  perform public.require_report_range(p_from, p_to);
  return query
  select f.created_by, coalesce(public.employee_name(f.created_by), '—'), count(*),
         sum(f.sales_ex_vat - f.refunds_ex_vat), round(sum(f.total) / count(*), 2), sum(f.refunded_total)
  from public.order_financials f
  where f.business_date between p_from and p_to
  group by f.created_by order by 4 desc;
end $$;

-- One call for the dashboard.
create or replace function public.dashboard(p_date date default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_day date := coalesce(p_date, public.bkk_date(now()));
  v_pnl jsonb;
  v_sales jsonb;
begin
  perform public.require_role('OWNER', 'MANAGER');
  v_pnl := public.report_pnl(v_day, v_day);
  v_sales := public.report_sales(v_day, v_day);
  return jsonb_build_object(
    'date', v_day,
    'pnl', v_pnl,
    'orders', v_sales -> 'summary' -> 'orders',
    'avg_ticket', v_sales -> 'summary' -> 'avg_ticket',
    'by_payment', v_sales -> 'by_payment',
    'by_hour', v_sales -> 'by_hour',
    'trend', public.report_sales(v_day - 13, v_day) -> 'by_day',
    'top_products', coalesce((select jsonb_agg(to_jsonb(p)) from (select * from public.report_products(v_day, v_day) limit 5) p), '[]'::jsonb),
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name_th', name_th, 'unit', unit, 'stock_qty', stock_qty, 'reorder_level', reorder_level)
                                   order by stock_qty / nullif(reorder_level, 0))
                           from public.ingredients where is_active and stock_qty <= reorder_level), '[]'::jsonb),
    'open_session', public.current_cash_session_id() is not null
  );
end $$;

revoke all on public.order_financials from anon, authenticated;
grant execute on function public.report_sales(date, date), public.report_products(date, date), public.report_pnl(date, date),
  public.report_inventory(date, date), public.report_purchases(date, date), public.report_production(date, date),
  public.report_expenses(date, date), public.report_cash(date, date), public.report_employee_sales(date, date),
  public.dashboard(date) to authenticated;

-- =============================================================================
-- Phase 14: Telegram bot commands (/today, /month, /latest)
-- The webhook runs as service_role without a user session. These functions act
-- for the linked employee only, so every role check and report is the same one
-- the app uses.
-- =============================================================================

-- Who is this Telegram user, with their role. Empty when unlinked or inactive.
create or replace function public.telegram_staff(p_telegram_user_id bigint)
returns table (employee_id uuid, user_id uuid, display_name text, role public.app_role)
language sql stable security definer set search_path = public
as $$
  select e.id, e.user_id, e.display_name, r.code
  from public.telegram_accounts t
  join public.employees e on e.id = t.employee_id
  join public.roles r on r.id = e.role_id
  where t.telegram_user_id = p_telegram_user_id and e.is_active and e.user_id is not null
$$;

-- Profit & loss summary for a linked OWNER/MANAGER, computed by report_pnl / report_sales
-- as that employee (auth.uid() is set for this transaction only).
create or replace function public.telegram_summary(p_telegram_user_id bigint, p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_pnl jsonb;
  v_sales jsonb;
begin
  select user_id into v_user from public.telegram_staff(p_telegram_user_id);
  if v_user is null then raise exception 'NOT_FOUND: linked employee' using errcode = 'P0001'; end if;
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  v_pnl := public.report_pnl(p_from, p_to);           -- enforces OWNER/MANAGER and the date range
  v_sales := public.report_sales(p_from, p_to) -> 'summary';
  perform set_config('request.jwt.claim.sub', '', true);
  return v_pnl || jsonb_build_object(
    'orders', v_sales -> 'orders',
    'cancelled', v_sales -> 'cancelled',
    'pending_bills', (select count(*) from public.bill_submissions where status = 'PENDING'),
    'purchases', (select coalesce(sum(total_cost), 0) from public.inventory_transactions
                  where transaction_type = 'PURCHASE'
                    and created_at >= (p_from::timestamp at time zone 'Asia/Bangkok')
                    and created_at < ((p_to + 1)::timestamp at time zone 'Asia/Bangkok')));
end $$;

-- Latest bill submissions: everything for OWNER/MANAGER, own submissions for other staff.
create or replace function public.telegram_latest_bills(p_telegram_user_id bigint, p_limit integer default 5)
returns setof public.bill_submissions
language plpgsql stable security definer set search_path = public
as $$
declare v_staff record;
begin
  select * into v_staff from public.telegram_staff(p_telegram_user_id);
  if v_staff.employee_id is null then raise exception 'NOT_FOUND: linked employee' using errcode = 'P0001'; end if;
  return query
    select * from public.bill_submissions b
    where v_staff.role in ('OWNER', 'MANAGER') or b.submitted_by = v_staff.employee_id
    order by b.created_at desc
    limit least(greatest(coalesce(p_limit, 5), 1), 20);
end $$;

revoke execute on function
  public.telegram_staff(bigint), public.telegram_summary(bigint, date, date), public.telegram_latest_bills(bigint, integer)
from public, anon, authenticated;
grant execute on function
  public.telegram_staff(bigint), public.telegram_summary(bigint, date, date), public.telegram_latest_bills(bigint, integer)
to service_role;

-- =============================================================================
-- Phase 11: Customer points adjustments (promotions use plain RLS-guarded writes)
-- =============================================================================
create or replace function public.adjust_customer_points(p_customer_id uuid, p_change integer, p_note text)
returns public.customers
language plpgsql security definer set search_path = public
as $$
declare v_row public.customers;
begin
  perform public.require_role('OWNER', 'MANAGER');
  if p_change is null or p_change = 0 then raise exception 'VALIDATION: change must not be zero' using errcode = 'P0001'; end if;
  if p_note is null or length(trim(p_note)) = 0 then raise exception 'VALIDATION: a note is required' using errcode = 'P0001'; end if;
  perform 1 from public.customers where id = p_customer_id for update;
  if not found then raise exception 'NOT_FOUND: customer' using errcode = 'P0001'; end if;
  perform public.post_points(p_customer_id, p_change, 'ADJUST', null, trim(p_note));
  select * into v_row from public.customers where id = p_customer_id;
  perform public.write_audit('ADJUST_POINTS', 'customers', p_customer_id, null, jsonb_build_object('change', p_change, 'note', trim(p_note)));
  return v_row;
end $$;
grant execute on function public.adjust_customer_points(uuid, integer, text) to authenticated;

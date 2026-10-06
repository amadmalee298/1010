-- =============================================================================
-- Phase 12: administration safeguards
-- =============================================================================

-- There must always be at least one active OWNER (prevents locking the shop out).
create or replace function public.ensure_active_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.employees e join public.roles r on r.id = e.role_id
    where r.code = 'OWNER' and e.is_active and e.user_id is not null
  ) and exists (select 1 from public.employees) then
    raise exception 'VALIDATION: at least one active owner is required' using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger employees_keep_owner after update or delete on public.employees
  deferrable initially deferred for each row execute function public.ensure_active_owner();

-- Employee directory for the owner screen (role code + email in one row).
create view public.employee_directory with (security_invoker = true) as
select e.id, e.user_id, e.display_name, e.phone, e.is_active, e.created_at, r.code as role, u.email
from public.employees e
join public.roles r on r.id = e.role_id
left join public.users u on u.id = e.user_id;
grant select on public.employee_directory to authenticated;

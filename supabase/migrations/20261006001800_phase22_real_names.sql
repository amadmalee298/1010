-- Phase 22: real names on documents
--  * the shop owner's legal name (only when there is exactly one active owner without one)
--  * already-issued substitute receipts: replace a nickname (display name) with the person's legal name.
--    Names typed by hand on a receipt (anything other than the display name) are left alone.

do $$
declare v_owners int;
begin
  select count(*) into v_owners
    from public.employees e join public.roles r on r.id = e.role_id
   where r.code = 'OWNER' and e.is_active;
  if v_owners = 1 then
    update public.employees e
       set legal_name = 'กามีนี สาและ'
      from public.roles r
     where r.id = e.role_id and r.code = 'OWNER' and e.is_active
       and nullif(trim(coalesce(e.legal_name, '')), '') is null;
  else
    raise notice 'owner legal name not set: % active owners', v_owners;
  end if;
end $$;

update public.bill_submissions b
   set payer_name = trim(e.legal_name)
  from public.employees e
 where b.status = 'APPROVED'
   and e.id = b.submitted_by
   and nullif(trim(coalesce(e.legal_name, '')), '') is not null
   and (b.payer_name is null or trim(b.payer_name) in (trim(e.display_name), trim(b.submitter_name)))
   and b.payer_name is distinct from trim(e.legal_name);

update public.bill_submissions b
   set approver_name = trim(e.legal_name)
  from public.employees e
 where b.status = 'APPROVED'
   and e.user_id = b.reviewed_by
   and nullif(trim(coalesce(e.legal_name, '')), '') is not null
   and (b.approver_name is null or trim(b.approver_name) = trim(e.display_name))
   and b.approver_name is distinct from trim(e.legal_name);

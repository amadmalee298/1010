-- Phase 18: reversing an opening-balance journal must stay an opening entry.
-- Before, the reversal lost is_opening, so its cash lines moved from "opening cash" into
-- operating activities and the cash flow statement no longer netted to zero.

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
  insert into public.journal_entries (entry_number, entry_date, memo, is_opening, reverses, created_by)
  values (public.next_document_number('JV', 'public.journal_entries', 'entry_number'), coalesce(p_entry_date, public.bkk_date(now())),
          left('กลับรายการ ' || v_src.entry_number || ': ' || v_src.memo, 300), v_src.is_opening, p_id, auth.uid())
  returning * into v_entry;
  insert into public.journal_lines (entry_id, account_code, debit, credit, note)
  select v_entry.id, account_code, credit, debit, note from public.journal_lines where entry_id = p_id;
  return v_entry;
end $$;

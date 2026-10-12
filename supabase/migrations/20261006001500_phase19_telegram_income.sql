-- Phase 19: record income (e.g. a day's takings) from Telegram.
-- "12/10/69 รายได้ร้าน 2,319" → a draft; the owner/manager picks cash or transfer → a journal
-- entry Dr 1001 (cash) or 1010 (bank) / Cr 4000 sales. It can be undone from the same message.
-- Webhook only (service role).

create table public.telegram_income_drafts (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null,
  entry_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  memo text not null check (length(trim(memo)) between 1 and 300),
  journal_id uuid references public.journal_entries (id),
  created_at timestamptz not null default now()
);
alter table public.telegram_income_drafts enable row level security;
revoke all on public.telegram_income_drafts from public, anon, authenticated;

-- The linked owner/manager's user id, or an error.
create or replace function public.telegram_require_manager(p_telegram_user_id bigint)
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare v_staff record;
begin
  select * into v_staff from public.telegram_staff(p_telegram_user_id);
  if v_staff.employee_id is null then raise exception 'NOT_FOUND: linked employee' using errcode = 'P0001'; end if;
  if v_staff.role not in ('OWNER', 'MANAGER') then raise exception 'FORBIDDEN: owners and managers only' using errcode = 'P0001'; end if;
  return v_staff.user_id;
end $$;

create or replace function public.telegram_income_draft(p_telegram_user_id bigint, p_entry_date date, p_amount numeric, p_memo text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  perform public.telegram_require_manager(p_telegram_user_id);
  if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount then
    raise exception 'VALIDATION: amount must be > 0 with at most 2 decimals' using errcode = 'P0001';
  end if;
  insert into public.telegram_income_drafts (telegram_user_id, entry_date, amount, memo)
  values (p_telegram_user_id, coalesce(p_entry_date, public.bkk_date(now())), p_amount, left(trim(p_memo), 300))
  returning id into v_id;
  return v_id;
end $$;

-- p_account: '1001' cash outside the drawer, '1010' bank / PromptPay
-- Returns {entry_number, entry_date, amount, memo} for the bot's confirmation.
create or replace function public.telegram_post_income(p_telegram_user_id bigint, p_draft uuid, p_account text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_draft public.telegram_income_drafts;
  v_entry public.journal_entries;
begin
  v_user := public.telegram_require_manager(p_telegram_user_id);
  if p_account not in ('1001', '1010') then raise exception 'VALIDATION: account' using errcode = 'P0001'; end if;
  select * into v_draft from public.telegram_income_drafts where id = p_draft for update;
  if not found then raise exception 'NOT_FOUND: draft' using errcode = 'P0001'; end if;
  if v_draft.journal_id is not null then raise exception 'INVALID_STATE: already recorded' using errcode = 'P0001'; end if;
  insert into public.journal_entries (entry_number, entry_date, memo, created_by)
  values (public.next_document_number('JV', 'public.journal_entries', 'entry_number'), v_draft.entry_date,
          'รายรับ (Telegram): ' || v_draft.memo, v_user)
  returning * into v_entry;
  insert into public.journal_lines (entry_id, account_code, debit, credit)
  values (v_entry.id, p_account, v_draft.amount, 0), (v_entry.id, '4000', 0, v_draft.amount);
  update public.telegram_income_drafts set journal_id = v_entry.id where id = p_draft;
  return jsonb_build_object('entry_number', v_entry.entry_number, 'entry_date', v_draft.entry_date,
                            'amount', v_draft.amount, 'memo', v_draft.memo);
end $$;

-- Drops a draft that was never recorded (button "ยกเลิก").
create or replace function public.telegram_discard_income(p_telegram_user_id bigint, p_draft uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.telegram_require_manager(p_telegram_user_id);
  delete from public.telegram_income_drafts where id = p_draft and journal_id is null;
  if not found then raise exception 'INVALID_STATE: already recorded' using errcode = 'P0001'; end if;
end $$;

-- Undoes recorded income with a reversing entry (only entries made by this flow).
create or replace function public.telegram_reverse_income(p_telegram_user_id bigint, p_draft uuid)
returns public.journal_entries
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_draft public.telegram_income_drafts;
  v_src public.journal_entries;
  v_entry public.journal_entries;
begin
  v_user := public.telegram_require_manager(p_telegram_user_id);
  select * into v_draft from public.telegram_income_drafts where id = p_draft;
  if not found or v_draft.journal_id is null then raise exception 'NOT_FOUND: income' using errcode = 'P0001'; end if;
  select * into v_src from public.journal_entries where id = v_draft.journal_id;
  if exists (select 1 from public.journal_entries where reverses = v_src.id) then
    raise exception 'INVALID_STATE: already reversed' using errcode = 'P0001';
  end if;
  insert into public.journal_entries (entry_number, entry_date, memo, is_opening, reverses, created_by)
  values (public.next_document_number('JV', 'public.journal_entries', 'entry_number'), public.bkk_date(now()),
          left('กลับรายการ ' || v_src.entry_number || ': ' || v_src.memo, 300), v_src.is_opening, v_src.id, v_user)
  returning * into v_entry;
  insert into public.journal_lines (entry_id, account_code, debit, credit, note)
  select v_entry.id, account_code, credit, debit, note from public.journal_lines where entry_id = v_src.id;
  return v_entry;
end $$;

revoke execute on function
  public.telegram_require_manager(bigint), public.telegram_income_draft(bigint, date, numeric, text),
  public.telegram_post_income(bigint, uuid, text), public.telegram_discard_income(bigint, uuid),
  public.telegram_reverse_income(bigint, uuid)
from public, anon, authenticated;
grant execute on function
  public.telegram_income_draft(bigint, date, numeric, text), public.telegram_post_income(bigint, uuid, text),
  public.telegram_discard_income(bigint, uuid), public.telegram_reverse_income(bigint, uuid)
to service_role;

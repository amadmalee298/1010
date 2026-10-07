-- Phase 17: bill actions from Telegram
--  * inline buttons on the bot's bill card: attach a transfer slip / proof of purchase,
--    cancel a bill that is still waiting for approval
--  * bill_card(): everything the bot shows about one bill, in one call
-- All functions here are for the webhook (service role) only.

-- "Send me the photo next": set by a button, consumed by the next photo from that Telegram user.
create table public.telegram_pending_uploads (
  telegram_user_id bigint primary key,
  bill_id uuid not null references public.bill_submissions (id) on delete cascade,
  kind text not null check (kind in ('SLIP', 'EVIDENCE', 'OTHER')),
  expires_at timestamptz not null
);
alter table public.telegram_pending_uploads enable row level security;
revoke all on public.telegram_pending_uploads from public, anon, authenticated;

-- The bill a linked Telegram user may act on: their own submission, or any bill for owners/managers.
create or replace function public.telegram_bill_for(p_telegram_user_id bigint, p_submission_number text)
returns public.bill_submissions
language plpgsql stable security definer set search_path = public
as $$
declare
  v_staff record;
  v_bill public.bill_submissions;
begin
  select * into v_staff from public.telegram_staff(p_telegram_user_id);
  if v_staff.employee_id is null then raise exception 'NOT_FOUND: linked employee' using errcode = 'P0001'; end if;
  select * into v_bill from public.bill_submissions where submission_number = p_submission_number;
  if not found or not (v_bill.submitted_by = v_staff.employee_id or v_staff.role in ('OWNER', 'MANAGER')) then
    raise exception 'NOT_FOUND: bill' using errcode = 'P0001';
  end if;
  return v_bill;
end $$;

-- Attachments now carry their kind (slip / proof of purchase / other).
drop function public.telegram_add_attachment(bigint, text, text);
create function public.telegram_add_attachment(
  p_telegram_user_id bigint, p_submission_number text, p_path text, p_kind text default 'EVIDENCE'
) returns public.bill_attachments
language plpgsql security definer set search_path = public
as $$
declare
  v_bill public.bill_submissions := public.telegram_bill_for(p_telegram_user_id, p_submission_number);
  v_user uuid := (select user_id from public.telegram_staff(p_telegram_user_id));
  v_row public.bill_attachments;
begin
  if p_path is null or p_path !~ '^bills/[A-Za-z0-9/_.-]+$' then raise exception 'VALIDATION: invalid path' using errcode = 'P0001'; end if;
  insert into public.bill_attachments (bill_id, kind, path, uploaded_by)
  values (v_bill.id, upper(coalesce(p_kind, 'EVIDENCE')), p_path, v_user)
  returning * into v_row;
  return v_row;
end $$;

-- Button "แนบสลิป": the next photo (within 10 minutes) goes to this bill.
create or replace function public.telegram_await_upload(p_telegram_user_id bigint, p_submission_number text, p_kind text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_bill public.bill_submissions := public.telegram_bill_for(p_telegram_user_id, p_submission_number);
begin
  if v_bill.status = 'REJECTED' or v_bill.voided_at is not null then
    raise exception 'INVALID_STATE: bill is cancelled' using errcode = 'P0001';
  end if;
  insert into public.telegram_pending_uploads (telegram_user_id, bill_id, kind, expires_at)
  values (p_telegram_user_id, v_bill.id, upper(p_kind), now() + interval '10 minutes')
  on conflict (telegram_user_id) do update set bill_id = excluded.bill_id, kind = excluded.kind, expires_at = excluded.expires_at;
end $$;

-- Consumes the waiting upload, if any and not expired.
create or replace function public.telegram_take_upload(p_telegram_user_id bigint)
returns table (submission_number text, kind text)
language plpgsql security definer set search_path = public
as $$
begin
  return query
    with taken as (
      delete from public.telegram_pending_uploads p where p.telegram_user_id = p_telegram_user_id returning p.bill_id, p.kind, p.expires_at
    )
    select b.submission_number, t.kind from taken t join public.bill_submissions b on b.id = t.bill_id
    where t.expires_at > now();
end $$;

-- Button "ยกเลิกรายการ": only while the bill still waits for approval (nothing has been posted yet).
create or replace function public.telegram_cancel_bill(p_telegram_user_id bigint, p_submission_number text)
returns public.bill_submissions
language plpgsql security definer set search_path = public
as $$
declare
  v_bill public.bill_submissions := public.telegram_bill_for(p_telegram_user_id, p_submission_number);
  v_staff record;
begin
  select * into v_staff from public.telegram_staff(p_telegram_user_id);
  update public.bill_submissions
     set status = 'REJECTED', reviewed_by = v_staff.user_id, reviewed_at = now(),
         review_note = case when submitted_by = v_staff.employee_id then 'ผู้ส่งยกเลิกทาง Telegram'
                            else 'ยกเลิกทาง Telegram โดย ' || v_staff.display_name end
   where id = v_bill.id and status = 'PENDING'
  returning * into v_bill;
  if not found then raise exception 'INVALID_STATE: bill is not pending' using errcode = 'P0001'; end if;
  delete from public.telegram_pending_uploads where bill_id = v_bill.id;
  perform public.write_audit('CANCEL_BILL_TELEGRAM', 'bill_submissions', v_bill.id, null,
    jsonb_build_object('telegram_user_id', p_telegram_user_id));
  return v_bill;
end $$;

-- Everything the bot card shows about one bill.
create or replace function public.bill_card(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_bill public.bill_submissions;
  v_lines jsonb;
  v_stock boolean;
  v_category text;
  v_payer_signed boolean;
begin
  select * into v_bill from public.bill_submissions where id = p_id;
  if not found then raise exception 'NOT_FOUND: bill' using errcode = 'P0001'; end if;
  v_lines := coalesce(v_bill.approved_lines, v_bill.extraction -> 'lines', '[]'::jsonb);
  if jsonb_typeof(v_lines) <> 'array' then v_lines := '[]'::jsonb; end if;
  v_stock := exists (select 1 from jsonb_array_elements(v_lines) l where nullif(l ->> 'ingredient_id', '') is not null)
             and v_bill.status = 'APPROVED';
  select category into v_category from public.expenses where id = v_bill.expense_id;
  v_payer_signed := case when v_bill.status = 'APPROVED' then v_bill.payer_signature is not null
                         else exists (select 1 from public.employee_signatures where employee_id = v_bill.submitted_by) end;
  return jsonb_build_object(
    'id', v_bill.id,
    'submission_number', v_bill.submission_number,
    'status', v_bill.status,
    'voided', v_bill.voided_at is not null,
    'void_reason', v_bill.void_reason,
    'review_note', v_bill.review_note,
    'total', coalesce(v_bill.total,
                      (select sum((l ->> 'amount')::numeric) from jsonb_array_elements(v_lines) l where (l ->> 'amount') ~ '^[0-9.]+$')),
    'descriptions', coalesce((select jsonb_agg(l ->> 'description') from jsonb_array_elements(v_lines) l
                              where length(trim(coalesce(l ->> 'description', ''))) > 0), '[]'::jsonb),
    'message_text', v_bill.message_text,
    'vendor', v_bill.vendor,
    'bill_date', coalesce(v_bill.bill_date, public.bkk_date(v_bill.created_at)),
    'has_receipt', v_bill.has_receipt,
    'substitute_number', v_bill.substitute_number,
    'payer_name', coalesce(v_bill.payer_name,
                           (select coalesce(nullif(trim(e.legal_name), ''), e.display_name) from public.employees e where e.id = v_bill.submitted_by),
                           v_bill.submitter_name),
    'payer_signed', v_payer_signed,
    'approver_signed', v_bill.approver_signature is not null,
    'paid_method', v_bill.paid_method,
    'paid_from_drawer', v_bill.paid_from_drawer,
    'category', case when v_stock and v_category is not null then 'ซื้อวัตถุดิบ, ' || v_category
                     when v_stock then 'ซื้อวัตถุดิบ' else v_category end,
    'attachments', jsonb_build_object(
      'SLIP', (select count(*) from public.bill_attachments where bill_id = p_id and kind = 'SLIP'),
      'EVIDENCE', (select count(*) from public.bill_attachments where bill_id = p_id and kind = 'EVIDENCE'),
      'OTHER', (select count(*) from public.bill_attachments where bill_id = p_id and kind = 'OTHER')),
    'company', coalesce(nullif((select value #>> '{}' from public.settings where key = 'company_name'), ''),
                        (select value #>> '{}' from public.settings where key = 'shop_name')),
    'submitter_chat_id', (select chat_id from public.telegram_accounts where employee_id = v_bill.submitted_by)
  );
end $$;

create or replace function public.telegram_bill_card(p_telegram_user_id bigint, p_submission_number text)
returns jsonb
language sql stable security definer set search_path = public
as $$ select public.bill_card((public.telegram_bill_for(p_telegram_user_id, p_submission_number)).id) $$;

revoke execute on function
  public.telegram_bill_for(bigint, text), public.telegram_add_attachment(bigint, text, text, text),
  public.telegram_await_upload(bigint, text, text), public.telegram_take_upload(bigint),
  public.telegram_cancel_bill(bigint, text), public.bill_card(uuid), public.telegram_bill_card(bigint, text)
from public, anon, authenticated;
grant execute on function
  public.telegram_add_attachment(bigint, text, text, text),
  public.telegram_await_upload(bigint, text, text), public.telegram_take_upload(bigint),
  public.telegram_cancel_bill(bigint, text), public.bill_card(uuid), public.telegram_bill_card(bigint, text)
to service_role;

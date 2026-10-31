-- Phase 20: the bot card knows when a bill's photo is a bank transfer slip, so the slip is shown
-- as evidence without also storing it as a second (duplicate) attachment.
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
    'submitter_chat_id', (select chat_id from public.telegram_accounts where employee_id = v_bill.submitted_by),
    'has_photo', v_bill.photo_path is not null,
    'is_slip', coalesce((v_bill.extraction ->> 'is_slip')::boolean, false)
  );
end $$;


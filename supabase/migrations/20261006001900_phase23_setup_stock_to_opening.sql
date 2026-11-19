-- Phase 23: stock set-up corrections are not losses.
-- While setting up, stock was counted down to 0 and received again at the real price. Each decrease
-- posted to 5300 (stock shrinkage), so the P&L showed a large loss. One journal per day moves those
-- decreases to 3100 (opening stock) — the same account the re-entered stock was credited to.
-- Only manual adjustments and stock counts made before this migration ran are moved; voided bills
-- ('bill_void') keep their own entries. The original stock movements are not changed.

do $$
declare
  r record;
  v_id uuid;
begin
  for r in
    select public.bkk_date(i.created_at) as d, sum(round(abs(i.total_cost), 2)) as amount, count(*) as n
      from public.inventory_transactions i
     where i.transaction_type = 'ADJUSTMENT'
       and i.quantity < 0
       and coalesce(i.reference_type, '') in ('adjustment', 'stock_count', '')
       and round(abs(i.total_cost), 2) <> 0
     group by 1
     order by 1
  loop
    insert into public.journal_entries (entry_number, entry_date, memo, is_opening)
    values (public.next_document_number('JV', 'public.journal_entries', 'entry_number'), r.d,
            format('ย้ายยอดปรับสต็อกช่วงตั้งต้นไปสินค้ายกมา (%s รายการ)', r.n), true)
    returning id into v_id;
    insert into public.journal_lines (entry_id, account_code, debit, credit, note) values
      (v_id, '3100', r.amount, 0, 'สต็อกช่วงตั้งต้น ไม่ใช่สินค้าขาดจริง'),
      (v_id, '5300', 0, r.amount, null);
  end loop;
end $$;

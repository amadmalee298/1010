import { describe, expect, it } from 'vitest';
import { billCardButtons, billCardText, kindFromCaption, parseCallback, parseCommand, summaryText, type BillCard } from '@/domain/telegram';

describe('parseCommand', () => {
  it('reads command, bot suffix and arguments', () => {
    expect(parseCommand('/today')).toEqual({ name: 'today', args: '' });
    expect(parseCommand('/Jot@custard_bill_bot ค่าน้ำแข็ง 40')).toEqual({ name: 'jot', args: 'ค่าน้ำแข็ง 40' });
    expect(parseCommand('/jot\nค่าแก๊ส 380')).toEqual({ name: 'jot', args: 'ค่าแก๊ส 380' });
  });
  it('ignores plain text', () => {
    expect(parseCommand('ค่ากุ้งสด 1060')).toBeNull();
    expect(parseCommand('/ 12')).toBeNull();
  });
});

describe('summaryText', () => {
  const base = { net_sales: 1000, orders: 12, cancelled: 0, cogs: 400, gross_profit: 600, gross_margin: 0.6,
    expenses_total: 200, waste: 0, shrinkage: 0, net_profit: 400, net_margin: 0.4, purchases: 150, pending_bills: 0 };
  it('formats the P&L lines', () => {
    const t = summaryText('สรุปวันนี้', base, 'https://shop.example');
    expect(t).toContain('ยอดขายสุทธิ (ไม่รวม VAT): ฿1,000.00');
    expect(t).toContain('กำไรขั้นต้น: ฿600.00 (60.0%)');
    expect(t).toContain('กำไรสุทธิ: ฿400.00 (40.0%)');
    expect(t).not.toContain('ของเสีย');
    expect(t).not.toContain('บิลรออนุมัติ');
  });
  it('mentions waste and pending bills when present', () => {
    const t = summaryText('x', { ...base, waste: 20, shrinkage: 5, pending_bills: 2, gross_margin: null }, 'https://shop.example');
    expect(t).toContain('ของเสีย/สูญหาย: ฿25.00');
    expect(t).toContain('บิลรออนุมัติ 2 รายการ\nhttps://shop.example/bills');
    expect(t).toContain('(–)');
  });
});

describe('bill card', () => {
  const base: BillCard = {
    id: 'b1', submission_number: 'BL261006-0001', status: 'APPROVED', voided: false, void_reason: null, review_note: null,
    total: 1060, descriptions: ['ค่ากุ้งสด ปลาหมึก'], message_text: 'ค่ากุ้งสด ปลาหมึก 1060', vendor: null, bill_date: '2026-10-06',
    has_receipt: false, substitute_number: '2569/10-001', payer_name: 'อาห์มัด มะหลี', payer_signed: false, approver_signed: false,
    paid_method: 'TRANSFER', paid_from_drawer: false, category: 'ซื้อวัตถุดิบ', attachments: { SLIP: 0, EVIDENCE: 1, OTHER: 0 },
    company: 'บริษัท กะเพรา เอ็นเตอร์ไพรส์ จำกัด (สำนักงานใหญ่)', submitter_chat_id: 1,
  };
  it('renders the approved layout', () => {
    expect(billCardText(base)).toBe([
      '✅ บันทึกเรียบร้อย', '🔖 BL261006-0001', '━━━━━━━━━━━━━━',
      '📉 รายจ่าย  -1,060.00 บาท', '📝 ค่ากุ้งสด ปลาหมึก', '',
      '📅 วันที่: 6 ต.ค. 2569', '💳 สถานะการจ่าย: ✅ จ่ายแล้ว (โอน)', '🗂 หมวดหมู่: ซื้อวัตถุดิบ',
      '📄 เอกสาร: ใบรับรองแทนใบเสร็จ 2569/10-001', '👤 ผู้เบิกจ่าย: อาห์มัด มะหลี',
      '✍️ ลายเซ็น: ผู้เบิก ⏳ · ผู้อนุมัติ ⏳', '📎 หลักฐาน: หลักฐานการซื้อ 1',
      '🏢 ธุรกิจ: บริษัท กะเพรา เอ็นเตอร์ไพรส์ จำกัด (สำนักงานใหญ่)',
    ].join('\n'));
  });
  it('shows pending and cancelled states', () => {
    const pending = billCardText({ ...base, status: 'PENDING', substitute_number: null, category: null, attachments: { SLIP: 0, EVIDENCE: 0, OTHER: 0 } });
    expect(pending).toContain('📥 รับรายการแล้ว · รออนุมัติ');
    expect(pending).toContain('⏳ รอผู้จัดการอนุมัติ');
    expect(pending).toContain('(ออกเลขหลังอนุมัติ)');
    expect(pending).toContain('📎 หลักฐาน: ยังไม่มี');
    expect(pending).not.toContain('หมวดหมู่');
    expect(billCardText({ ...base, voided: true, void_reason: 'ส่งซ้ำ' })).toContain('เหตุผลที่ยกเลิก: ส่งซ้ำ');
  });
  it('offers attach while alive, cancel only while pending', () => {
    const data = (c: BillCard, url?: string) => billCardButtons(c, url).flat().map((b) => ('callback_data' in b ? b.callback_data : b.url));
    expect(data(base)).toEqual(['att:SLIP:BL261006-0001', 'att:EVIDENCE:BL261006-0001']);
    expect(data({ ...base, status: 'PENDING' }, 'https://x/bills/b1')).toEqual(['att:SLIP:BL261006-0001', 'att:EVIDENCE:BL261006-0001', 'cancel:BL261006-0001', 'https://x/bills/b1']);
    expect(data({ ...base, status: 'REJECTED' })).toEqual([]);
    expect(data({ ...base, voided: true }, 'http://insecure')).toEqual([]);
  });
  it('parses button data and captions', () => {
    expect(parseCallback('att:SLIP:BL261006-0001')).toEqual({ action: 'attach', kind: 'SLIP', number: 'BL261006-0001' });
    expect(parseCallback('cancel!:BL261006-0001')).toEqual({ action: 'confirm_cancel', number: 'BL261006-0001' });
    expect(parseCallback('keep:BL261006-0001')).toEqual({ action: 'keep', number: 'BL261006-0001' });
    expect(parseCallback('att:EVIL:BL1')).toBeNull();
    expect(parseCallback(undefined)).toBeNull();
    expect(kindFromCaption('สลิปโอน')).toBe('SLIP');
    expect(kindFromCaption('')).toBe('EVIDENCE');
  });
});

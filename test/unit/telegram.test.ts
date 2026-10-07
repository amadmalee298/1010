import { describe, expect, it } from 'vitest';
import { parseCommand, summaryText } from '@/domain/telegram';

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

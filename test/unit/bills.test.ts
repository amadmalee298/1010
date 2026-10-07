import { describe, expect, it } from 'vitest';
import { bahtText, formatTaxId, parseExpenseText, substituteReceiptHtml } from '@/domain/bills';

describe('bahtText', () => {
  it.each([
    [0, 'ศูนย์บาทถ้วน'],
    [1, 'หนึ่งบาทถ้วน'],
    [11, 'สิบเอ็ดบาทถ้วน'],
    [21, 'ยี่สิบเอ็ดบาทถ้วน'],
    [101, 'หนึ่งร้อยเอ็ดบาทถ้วน'],
    [1060, 'หนึ่งพันหกสิบบาทถ้วน'],
    [25_000, 'สองหมื่นห้าพันบาทถ้วน'],
    [1_000_000, 'หนึ่งล้านบาทถ้วน'],
    [1_000_001, 'หนึ่งล้านเอ็ดบาทถ้วน'],
    [21_500_000, 'ยี่สิบเอ็ดล้านห้าแสนบาทถ้วน'],
    [10.5, 'สิบบาทห้าสิบสตางค์'],
    [0.25, 'ยี่สิบห้าสตางค์'],
    [99.01, 'เก้าสิบเก้าบาทหนึ่งสตางค์'],
  ])('%s → %s', (n, text) => expect(bahtText(n)).toBe(text));

  it('rejects negatives', () => expect(() => bahtText(-1)).toThrow());
});

describe('parseExpenseText', () => {
  it('splits description and amount', () => {
    expect(parseExpenseText('ค่ากุ้งสด ปลาหมึก 1,060')).toMatchObject({ total: 1060, lines: [{ description: 'ค่ากุ้งสด ปลาหมึก', amount: 1060 }] });
    expect(parseExpenseText('ค่าแก๊ส 380.50 บาท')?.total).toBe(380.5);
    expect(parseExpenseText('ค่าน้ำแข็ง: 40')?.lines[0]?.description).toBe('ค่าน้ำแข็ง');
  });
  it('returns null without an amount or description', () => {
    expect(parseExpenseText('สวัสดี')).toBeNull();
    expect(parseExpenseText('500')).toBeNull();
  });
});

describe('substituteReceiptHtml', () => {
  const html = substituteReceiptHtml({
    number: '2569/10-001', date: '2026-10-06', payer: 'อาห์มัด <script>',
    company: { name: 'บริษัท ตัวอย่าง จำกัด', taxId: '0105562089123', address: 'กรุงเทพฯ', phone: '021234567' },
    lines: [{ description: 'ค่ากุ้งสด ปลาหมึก', amount: 1060, note: 'จาก Telegram' }],
  });
  it('fills the standard wording, Buddhist-era dates and the total in words', () => {
    expect(html).toContain('วันที่: 6 ตุลาคม 2569');
    expect(html).toContain('ตั้งแต่วันที่ 06/10/2569 ถึงวันที่ 06/10/2569');
    expect(html).toContain('หนึ่งพันหกสิบบาทถ้วน');
    expect(html).toContain('1,060.00');
    expect(html).toContain('0-1055-62089-12-3');
  });
  it('escapes user text', () => {
    expect(html).not.toContain('<script>');
    expect(html).toContain('อาห์มัด &lt;script&gt;');
  });
  it('formats tax ids', () => expect(formatTaxId('12')).toBe('12'));
});

describe('substituteReceiptHtml signatures', () => {
  const base = {
    number: '2569/10-002', date: '2026-10-07', payer: 'อาห์มัด',
    company: { name: 'บริษัท ตัวอย่าง จำกัด', taxId: '', address: '', phone: '' },
    lines: [{ description: 'ค่าแก๊ส', amount: 380, note: '' }],
  };
  it('places payer and approver signatures with the approver name', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const html = substituteReceiptHtml({ ...base, payerSignature: png, approverSignature: png, approverName: 'ผจก <b>' });
    expect(html.match(/<img class="sig"/g)).toHaveLength(2);
    expect(html).toContain('(ผจก &lt;b&gt;)');
  });
  it('leaves blank lines without signatures and ignores non-PNG data', () => {
    const html = substituteReceiptHtml({ ...base, payerSignature: 'javascript:alert(1)' });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript');
    expect(html).toContain('(..............................)');
  });
});

describe('substituteReceiptHtml voided', () => {
  it('stamps cancelled documents', () => {
    const html = substituteReceiptHtml({
      number: '2569/10-003', date: '2026-10-07', payer: 'a', voided: true,
      company: { name: 'x', taxId: '', address: '', phone: '' }, lines: [{ description: 'y', amount: 1, note: '' }],
    });
    expect(html).toContain('<div class="void">ยกเลิก</div>');
  });
});

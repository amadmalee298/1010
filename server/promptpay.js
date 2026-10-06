'use strict';
// สร้าง payload QR พร้อมเพย์ (มาตรฐาน EMVCo / Thai QR Payment)

function crc16(str) {
  let crc = 0xffff;
  for (const byte of Buffer.from(str, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (id, value) => id + String(value.length).padStart(2, '0') + value;

function formatTarget(id) {
  const digits = String(id).replace(/\D/g, '');
  if (digits.length >= 15) return tlv('03', digits); // e-Wallet ID
  if (digits.length >= 13) return tlv('02', digits); // เลขบัตรประชาชน / เลขผู้เสียภาษี
  if (digits.length === 10 && digits.startsWith('0')) return tlv('01', ('0066' + digits.slice(1))); // เบอร์มือถือ
  throw new Error('รหัสพร้อมเพย์ไม่ถูกต้อง (ใช้เบอร์มือถือ 10 หลัก / เลข 13 หลัก)');
}

function promptPayPayload(id, amount) {
  const hasAmount = Number(amount) > 0;
  let payload =
    tlv('00', '01') +
    tlv('01', hasAmount ? '12' : '11') +
    tlv('29', tlv('00', 'A000000677010111') + formatTarget(id)) +
    tlv('53', '764') +
    (hasAmount ? tlv('54', Number(amount).toFixed(2)) : '') +
    tlv('58', 'TH') +
    '6304';
  return payload + crc16(payload);
}

module.exports = { promptPayPayload, crc16 };

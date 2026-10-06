/** Thai QR Payment (PromptPay) payload builder — EMVCo merchant-presented QR with CRC16-CCITT. */

export function crc16(input: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(input)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

function target(id: string): string {
  const digits = id.replace(/\D/g, '');
  if (digits.length >= 15) return tlv('03', digits);                       // e-Wallet
  if (digits.length === 13) return tlv('02', digits);                      // national / tax ID
  if (digits.length === 10 && digits.startsWith('0')) return tlv('01', `0066${digits.slice(1)}`); // mobile
  throw new RangeError('PromptPay ID must be a 10-digit mobile number or 13-digit ID');
}

export function isValidPromptPayId(id: string): boolean {
  try { target(id); return true; } catch { return false; }
}

export function promptPayPayload(id: string, amount?: number): string {
  const withAmount = amount !== undefined && amount > 0;
  const body =
    tlv('00', '01') +
    tlv('01', withAmount ? '12' : '11') +
    tlv('29', tlv('00', 'A000000677010111') + target(id)) +
    tlv('53', '764') +
    (withAmount ? tlv('54', amount.toFixed(2)) : '') +
    tlv('58', 'TH') +
    '6304';
  return body + crc16(body);
}

/** All timestamps are stored in UTC; the shop operates in Asia/Bangkok (UTC+7, no DST). */
export const SHOP_TIME_ZONE = 'Asia/Bangkok';

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Business date (YYYY-MM-DD) in Bangkok for an instant. */
export function bangkokDate(instant: Date | string = new Date()): string {
  return dateFmt.format(typeof instant === 'string' ? new Date(instant) : instant);
}

/** Add days to a YYYY-MM-DD string. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** UTC instant at the start of a Bangkok calendar date. */
export function bangkokDayStartUtc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+07:00`);
}

export function formatDateTime(instant: string | Date, locale = 'th-TH'): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: SHOP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(typeof instant === 'string' ? new Date(instant) : instant);
}

export function formatDate(instant: string | Date, locale = 'th-TH'): string {
  const d = typeof instant === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(instant) ? new Date(`${instant}T12:00:00+07:00`) : new Date(instant);
  return new Intl.DateTimeFormat(locale, { timeZone: SHOP_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

export function formatTime(instant: string | Date, locale = 'th-TH'): string {
  return new Intl.DateTimeFormat(locale, { timeZone: SHOP_TIME_ZONE, hour: '2-digit', minute: '2-digit' })
    .format(typeof instant === 'string' ? new Date(instant) : instant);
}

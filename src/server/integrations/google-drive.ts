import 'server-only';

/**
 * Files documents into Google Drive through a small Google Apps Script web app
 * (docs/google-drive-apps-script.gs) that the owner deploys from their own Google
 * account — no Google Cloud project or OAuth client needed. The script converts
 * HTML to PDF itself, which renders Thai correctly.
 */
const scriptUrl = () => (process.env.GOOGLE_DRIVE_SCRIPT_URL ?? '').trim();
const scriptSecret = () => (process.env.GOOGLE_DRIVE_SCRIPT_SECRET ?? '').trim();
export const driveConfigured = () => scriptUrl().length > 0 && scriptSecret().length > 0;

/** Why the Apps Script call failed, in words the shop owner can act on. */
export class DriveError extends Error {
  constructor(public readonly reason: 'not-json' | 'bad-secret' | 'script', detail: string) {
    super(detail);
  }
  /** Thai explanation with the fix. */
  get hint(): string {
    if (this.reason === 'not-json') return 'สคริปต์ Google ไม่ได้ตอบกลับ: ตรวจว่า Deploy แบบ Web app และ "Who has access" เป็น Anyone และ GOOGLE_DRIVE_SCRIPT_URL ลงท้ายด้วย /exec';
    if (this.reason === 'bad-secret') return 'รหัสลับไม่ตรงกัน: SECRET ในสคริปต์ Google ต้องตรงกับ GOOGLE_DRIVE_SCRIPT_SECRET ใน Vercel (แก้สคริปต์แล้วต้อง Deploy → New version)';
    return `สคริปต์ Google แจ้งว่า: ${this.message} (ลองวางสคริปต์เวอร์ชันล่าสุดจาก GitHub แล้ว Deploy → New version)`;
  }
}

async function callScript(body: Record<string, unknown>): Promise<{ url: string }> {
  // Apps Script answers POST with a redirect to the result; fetch follows it.
  const res = await fetch(scriptUrl(), {
    method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: scriptSecret(), ...body }),
  });
  const text = await res.text();
  let json: { ok?: boolean; url?: string; error?: string };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new DriveError('not-json', `Google Drive script returned non-JSON (HTTP ${res.status})`);
  }
  if (json.ok && json.url) return { url: json.url };
  if (json.error === 'bad secret') throw new DriveError('bad-secret', 'bad secret');
  throw new DriveError('script', json.error ?? 'no url returned');
}

type Upload =
  | { kind: 'file'; name: string; mimeType: string; data: Buffer }
  | { kind: 'html-to-pdf'; name: string; html: string };

/** Uploads into "<root>/<folder...>" and returns the Drive link. */
export async function uploadToDrive(folder: readonly string[], upload: Upload): Promise<string> {
  if (!driveConfigured()) throw new Error('Google Drive is not configured');
  const body = upload.kind === 'file'
    ? { folder, name: upload.name, mimeType: upload.mimeType, base64: upload.data.toString('base64') }
    : { folder, name: upload.name, html: upload.html };
  return (await callScript(body)).url;
}

/** Link to the shop's root folder ("Custard POS") in Google Drive. */
export async function driveFolderUrl(): Promise<string> {
  if (!driveConfigured()) throw new Error('Google Drive is not configured');
  return (await callScript({ action: 'folder' })).url;
}

/** Folder for a bill date: ["2569-10"] (Buddhist-era year, like the documents). */
export function monthFolder(isoDate: string): string[] {
  const [y, m] = isoDate.split('-');
  return [`${Number(y) + 543}-${m}`];
}

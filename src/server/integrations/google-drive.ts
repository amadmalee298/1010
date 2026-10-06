import 'server-only';

/**
 * Files documents into Google Drive through a small Google Apps Script web app
 * (docs/google-drive-apps-script.gs) that the owner deploys from their own Google
 * account — no Google Cloud project or OAuth client needed. The script converts
 * HTML to PDF itself, which renders Thai correctly.
 */
const scriptUrl = () => process.env.GOOGLE_DRIVE_SCRIPT_URL ?? '';
const scriptSecret = () => process.env.GOOGLE_DRIVE_SCRIPT_SECRET ?? '';
export const driveConfigured = () => scriptUrl().length > 0 && scriptSecret().length > 0;

type Upload =
  | { kind: 'file'; name: string; mimeType: string; data: Buffer }
  | { kind: 'html-to-pdf'; name: string; html: string };

/** Uploads into "<root>/<folder...>" and returns the Drive link. */
export async function uploadToDrive(folder: readonly string[], upload: Upload): Promise<string> {
  if (!driveConfigured()) throw new Error('Google Drive is not configured');
  const body = upload.kind === 'file'
    ? { secret: scriptSecret(), folder, name: upload.name, mimeType: upload.mimeType, base64: upload.data.toString('base64') }
    : { secret: scriptSecret(), folder, name: upload.name, html: upload.html };
  // Apps Script answers POST with a redirect to the result; fetch follows it.
  const res = await fetch(scriptUrl(), { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  const text = await res.text();
  let json: { ok?: boolean; url?: string; error?: string };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(`Google Drive script returned non-JSON (${res.status}); check the deployment access is "Anyone"`);
  }
  if (!json.ok || !json.url) throw new Error(`Google Drive script: ${json.error ?? 'unknown error'}`);
  return json.url;
}

/** Folder for a bill date: ["2569-10"] (Buddhist-era year, like the documents). */
export function monthFolder(isoDate: string): string[] {
  const [y, m] = isoDate.split('-');
  return [`${Number(y) + 543}-${m}`];
}

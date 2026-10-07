/**
 * Custard POS → Google Drive
 *
 * Paste this whole file into a new project at https://script.google.com, set SECRET
 * below to a long random text (the same value goes into Vercel as
 * GOOGLE_DRIVE_SCRIPT_SECRET), then Deploy → New deployment → Web app:
 *   Execute as: Me      Who has access: Anyone
 * Copy the Web app URL into Vercel as GOOGLE_DRIVE_SCRIPT_URL.
 *
 * Files land in My Drive / "Custard POS" / <year-month> / ...
 * HTML documents (substitute receipts) are converted to PDF here, so Thai renders correctly.
 */
const SECRET = 'CHANGE-ME-to-a-long-random-text';
const ROOT_FOLDER = 'Custard POS';

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (!SECRET || SECRET.indexOf('CHANGE-ME') === 0 || req.secret !== SECRET) return reply({ ok: false, error: 'bad secret' });
    let folder = child(DriveApp, ROOT_FOLDER);
    if (req.action === 'folder') return reply({ ok: true, url: folder.getUrl() });
    (req.folder || []).forEach(function (name) { folder = child(folder, String(name)); });

    let blob;
    if (req.html) {
      blob = Utilities.newBlob(req.html, MimeType.HTML, 'doc.html').getAs(MimeType.PDF).setName(String(req.name) + '.pdf');
    } else {
      blob = Utilities.newBlob(Utilities.base64Decode(req.base64), req.mimeType || 'application/octet-stream', String(req.name));
    }
    const file = folder.createFile(blob);
    return reply({ ok: true, url: file.getUrl(), id: file.getId() });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function child(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

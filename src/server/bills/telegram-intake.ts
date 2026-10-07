import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import { formatTHB } from '@/domain/money';
import { bangkokDate } from '@/domain/datetime';
import { parseExpenseText, type BillExtraction } from '@/domain/bills';
import { downloadFile, pickImage, sendMessage, type TelegramUpdate } from '@/server/integrations/telegram';
import { readBill, type IngredientHint } from '@/server/integrations/bill-reader';
import { HELP, parseCommand, runCommand } from './telegram-commands';
import { driveConfigured, monthFolder, uploadToDrive } from '@/server/integrations/google-drive';

type Admin = SupabaseClient<Database>;

async function ingredientHints(admin: Admin): Promise<IngredientHint[]> {
  const { data } = await admin.from('ingredients').select('id, name_th, unit').eq('is_active', true).eq('item_type', 'RAW').order('name_th').limit(400);
  return (data ?? []).map((i) => ({ id: i.id, name: i.name_th, unit: i.unit }));
}

/** Telegram chats of linked owners/managers, to tell them a bill is waiting. */
async function managerChats(admin: Admin): Promise<number[]> {
  const { data: accounts } = await admin.from('telegram_accounts').select('chat_id, employee_id');
  if (!accounts?.length) return [];
  const { data: staff } = await admin.from('employee_directory').select('id, role, is_active')
    .in('id', accounts.map((a) => a.employee_id));
  const ok = new Set((staff ?? []).filter((s) => s.is_active && (s.role === 'OWNER' || s.role === 'MANAGER')).map((s) => s.id));
  return accounts.filter((a) => ok.has(a.employee_id)).map((a) => a.chat_id);
}

/** Drops AI-suggested ingredient ids that are not real ingredients. */
function sanitize(extraction: BillExtraction, hints: readonly IngredientHint[]): BillExtraction {
  const ids = new Set(hints.map((h) => h.id));
  return {
    ...extraction,
    bill_date: extraction.bill_date && /^\d{4}-\d{2}-\d{2}$/.test(extraction.bill_date) ? extraction.bill_date : null,
    lines: extraction.lines.map((l) => (l.ingredient_id && ids.has(l.ingredient_id) ? l : { ...l, ingredient_id: null, ingredient_quantity: null })),
  };
}

export async function handleTelegramUpdate(admin: Admin, update: TelegramUpdate, appOrigin: string): Promise<void> {
  const m = update.message;
  if (!m?.from || m.chat.type !== 'private') return;
  let text = (m.text ?? m.caption ?? '').trim();
  const reply = (msg: string) => sendMessage(m.chat.id, msg, m.message_id);

  // /start CODE links this Telegram account to an employee.
  const start = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?/);
  if (start) {
    if (!start[1]) return reply(`สวัสดีครับ 🍮\nเชื่อมบัญชีก่อน: เปิดแอป → เมนู "เชื่อม Telegram" แล้วกดลิงก์ที่ได้\n\n${HELP}`);
    const { data, error } = await admin.rpc('telegram_link_account', {
      p_code: start[1], p_telegram_user_id: m.from.id, p_chat_id: m.chat.id, p_username: m.from.username ?? null,
    });
    return reply(error ? 'รหัสเชื่อมบัญชีไม่ถูกต้องหรือหมดอายุ (ใช้ได้ 30 นาที) ขอรหัสใหม่ในแอปครับ' : `เชื่อมบัญชีกับ ${data} แล้ว ✅\n\n${HELP}`);
  }

  const { data: who } = await admin.rpc('telegram_staff', { p_telegram_user_id: m.from.id });
  const employee = who?.[0];
  if (!employee) return reply('ยังไม่ได้เชื่อมบัญชีกับร้าน: เปิดแอป → เมนู "เชื่อม Telegram" แล้วกดลิงก์ที่ได้');

  // Commands (/today, /latest, ...). "/jot <text>" continues below as a no-receipt expense.
  const command = !pickImage(m) ? parseCommand(text) : null;
  if (command) {
    const jot = await runCommand(admin, employee, command,
      { chatId: m.chat.id, telegramUserId: m.from.id, replyTo: m.message_id, appOrigin });
    if (jot === null) return;
    text = jot;
  }

  // Telegram re-delivers updates it thinks failed; never read the same bill twice.
  const { data: existing } = await admin.from('bill_submissions').select('id').eq('telegram_update_id', update.update_id).maybeSingle();
  if (existing) return;

  const image = pickImage(m);

  // A photo sent as a reply to "รับแล้ว ✅ BL…" is evidence for that bill (slip, receipt, goods).
  const replyNumber = (m.reply_to_message?.text ?? m.reply_to_message?.caption ?? '').match(/BL\d{6}-\d{4}/)?.[0];
  if (image && replyNumber) return attachToBill(admin, update.update_id, m.from.id, replyNumber, image, reply);

  if (!image && (!text || text.startsWith('/'))) return reply(HELP);

  const hints = await ingredientHints(admin);
  let photoPath: string | null = null;
  let photo: Buffer | null = null;
  if (image) {
    await sendMessage(m.chat.id, 'กำลังอ่านบิล… ⏳');
    photo = await downloadFile(image.fileId);
    const ext = image.mime.split('/')[1] ?? 'jpg';
    photoPath = `bills/${bangkokDate().slice(0, 7)}/${update.update_id}.${ext}`;
    const { error } = await admin.storage.from('expense-receipts').upload(photoPath, photo, { contentType: image.mime, upsert: true });
    if (error) throw new Error(`storage upload: ${error.message}`);
  }

  const read = await readBill({
    image: photo && image ? { data: photo, mime: image.mime as 'image/jpeg' } : undefined,
    text: text || undefined,
    ingredients: hints,
  });
  let extraction: BillExtraction | null = read.ok ? sanitize(read.data, hints) : null;
  if (!extraction && !image) extraction = parseExpenseText(text);
  if (!image && (!extraction || !extraction.is_bill || extraction.lines.length === 0)) {
    return reply(`ไม่เข้าใจรายการ ลองพิมพ์รายการตามด้วยยอดเงิน เช่น "ค่ากุ้งสด ปลาหมึก 1060"\n\n${HELP}`);
  }

  const total = extraction?.total ?? (extraction ? extraction.lines.reduce((s, l) => s + l.amount, 0) : null);
  const { data: bill, error } = await admin.rpc('submit_bill', {
    p_telegram_update_id: update.update_id, p_chat_id: m.chat.id, p_employee_id: employee.employee_id,
    p_has_receipt: Boolean(image), p_photo_path: photoPath, p_message_text: text || null,
    p_extraction: extraction as unknown as Json, p_extraction_error: read.ok ? null : read.error,
    p_vendor: extraction?.vendor ?? null, p_bill_date: extraction?.bill_date ?? null, p_total: total,
  });
  if (error || !bill) throw new Error(`submit_bill: ${error?.message ?? 'no row'}`);

  const link = `${appOrigin}/bills/${bill.id}`;
  const summary = [
    `รับแล้ว ✅ ${bill.submission_number}`,
    extraction?.vendor ? `ร้าน: ${extraction.vendor}` : null,
    total ? `ยอด: ${formatTHB(total)}` : null,
    extraction && !extraction.is_bill ? '⚠️ รูปนี้ไม่เหมือนบิล ผู้จัดการจะตรวจอีกครั้ง' : null,
    !read.ok && image ? '⚠️ อ่านบิลอัตโนมัติไม่ได้ ผู้จัดการจะกรอกเอง' : null,
    image ? null : '📝 ไม่มีบิล: จะออก "ใบรับรองแทนใบเสร็จ" หลังอนุมัติ',
    'รอผู้จัดการอนุมัติ',
  ].filter(Boolean).join('\n');
  await reply(summary);

  for (const chat of await managerChats(admin)) {
    if (chat === m.chat.id) continue;
    await sendMessage(chat, `🧾 บิลใหม่รออนุมัติ ${bill.submission_number} จาก ${employee.display_name}${total ? ` ${formatTHB(total)}` : ''}\n${link}`).catch(() => undefined);
  }

  // Keep a copy of the photo in Google Drive (best effort; the app keeps the original either way).
  if (photo && image && driveConfigured()) {
    try {
      const url = await uploadToDrive([...monthFolder(bangkokDate()), 'รูปบิล'], {
        kind: 'file', name: `${bill.submission_number}.${image.mime.split('/')[1] ?? 'jpg'}`, mimeType: image.mime, data: photo,
      });
      await admin.from('bill_submissions').update({ photo_url: url }).eq('id', bill.id);
    } catch (err) {
      console.error('[telegram] drive upload failed', err);
    }
  }
}

async function attachToBill(
  admin: Admin, updateId: number, telegramUserId: number, submissionNumber: string,
  image: { fileId: string; mime: string }, reply: (msg: string) => Promise<void>,
): Promise<void> {
  const data = await downloadFile(image.fileId);
  const ext = image.mime.split('/')[1] ?? 'jpg';
  const path = `bills/${bangkokDate().slice(0, 7)}/${submissionNumber}-att-${updateId}.${ext}`;
  const { error: upErr } = await admin.storage.from('expense-receipts').upload(path, data, { contentType: image.mime, upsert: true });
  if (upErr) throw new Error(`storage upload: ${upErr.message}`);
  const { data: row, error } = await admin.rpc('telegram_add_attachment', {
    p_telegram_user_id: telegramUserId, p_submission_number: submissionNumber, p_path: path,
  });
  if (error || !row) return reply(`แนบรูปไม่ได้: ไม่พบ ${submissionNumber} หรือคุณไม่ใช่ผู้ส่งบิลนี้`);
  await reply(`แนบรูปกับ ${submissionNumber} แล้ว ✅`);
  if (driveConfigured()) {
    try {
      const url = await uploadToDrive([...monthFolder(bangkokDate()), 'รูปบิล'], {
        kind: 'file', name: `${submissionNumber} หลักฐาน ${updateId}.${ext}`, mimeType: image.mime, data,
      });
      await admin.rpc('set_attachment_drive_url', { p_id: row.id, p_url: url });
    } catch (err) {
      console.error('[telegram] attachment drive upload failed', err);
    }
  }
}

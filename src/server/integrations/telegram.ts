import 'server-only';
import type { InlineButton } from '@/domain/telegram';

/** Minimal Telegram Bot API client (only what the bill inbox needs). */

export interface TelegramPhotoSize { file_id: string; width: number; height: number; file_size?: number }
export interface TelegramMessage {
  message_id: number;
  from?: { id: number; username?: string; first_name?: string };
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: { file_id: string; mime_type?: string; file_size?: number };
  reply_to_message?: { message_id: number; text?: string; caption?: string };
}
export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; username?: string };
  message?: { message_id: number; chat: { id: number; type: string } };
  data?: string;
}
export interface TelegramUpdate { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallbackQuery }

/** Pasted values often carry spaces, a newline, or BotFather's "bot" prefix from a URL. */
const token = () => (process.env.TELEGRAM_BOT_TOKEN ?? '').replace(/\s+/g, '').replace(/^bot(?=\d)/i, '');
export const webhookSecret = () => (process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim();
export const telegramConfigured = () => token().length > 0;
/** BotFather tokens look like 8123456789:AAH…(35 characters) */
export const tokenLooksValid = () => /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token());

export class TelegramError extends Error {
  constructor(public readonly status: number, public readonly description: string, method: string) {
    super(`Telegram ${method}: ${description}`);
  }
  /** Thai explanation with the fix. */
  get hint(): string {
    if (this.status === 404) return 'TELEGRAM_BOT_TOKEN ผิดรูปแบบ: คัดลอก token จาก @BotFather ใหม่ (รูปแบบ 123456789:AAH...) ไปวางใน Vercel แล้ว Redeploy';
    if (this.status === 401) return 'TELEGRAM_BOT_TOKEN ใช้ไม่ได้ (อาจถูกเปลี่ยนใน @BotFather): ขอ token ปัจจุบันด้วย /token ใน @BotFather แล้ววางใน Vercel และ Redeploy';
    if (/secret/i.test(this.description)) return 'TELEGRAM_WEBHOOK_SECRET ต้องเป็นอังกฤษ/ตัวเลขเท่านั้น (ใช้ _ หรือ - ได้) ยาว 16–256 ตัว แก้ใน Vercel แล้ว Redeploy';
    return this.message;
  }
}

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; result?: T; description?: string };
  if (!json.ok || json.result === undefined) throw new TelegramError(res.status, json.description ?? String(res.status), method);
  return json.result;
}

export interface ReplyKeyboard { keyboard: { text: string }[][]; resize_keyboard?: boolean; is_persistent?: boolean }
export interface InlineKeyboard { inline_keyboard: InlineButton[][] }

export async function sendMessage(chatId: number, text: string, replyTo?: number, keyboard?: ReplyKeyboard | InlineKeyboard): Promise<void> {
  await call('sendMessage', {
    chat_id: chatId, text, disable_web_page_preview: true,
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
}

/** Replaces a message the bot sent (e.g. a confirm prompt) with new text and buttons. */
export async function editMessage(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard): Promise<void> {
  await call('editMessageText', {
    chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true,
    reply_markup: keyboard ?? { inline_keyboard: [] },
  });
}

/** Stops the button spinner; a short text shows as a toast on the phone. */
export async function answerCallback(id: string, text?: string): Promise<void> {
  await call('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) }).catch(() => undefined);
}

/** Largest photo, or an image sent as a file. */
export function pickImage(m: TelegramMessage): { fileId: string; mime: string } | null {
  if (m.photo?.length) {
    const best = [...m.photo].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    return best ? { fileId: best.file_id, mime: 'image/jpeg' } : null;
  }
  const mime = m.document?.mime_type ?? '';
  if (m.document && /^image\/(jpeg|png|webp|gif)$/.test(mime)) return { fileId: m.document.file_id, mime };
  return null;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function downloadFile(fileId: string): Promise<Buffer> {
  const file = await call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
  if (!file.file_path) throw new Error('Telegram getFile: no file_path');
  if ((file.file_size ?? 0) > MAX_IMAGE_BYTES) throw new Error('Telegram file too large');
  const res = await fetch(`https://api.telegram.org/file/bot${token()}/${file.file_path}`);
  if (!res.ok) throw new Error(`Telegram download: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function setWebhook(url: string, secret: string): Promise<void> {
  await call('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
}

export async function getBotUsername(): Promise<string | null> {
  try {
    return (await call<{ username?: string }>('getMe', {})).username ?? null;
  } catch {
    return null;
  }
}

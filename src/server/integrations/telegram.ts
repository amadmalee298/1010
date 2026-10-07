import 'server-only';

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
}
export interface TelegramUpdate { update_id: number; message?: TelegramMessage }

const token = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
export const telegramConfigured = () => token().length > 0;

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok || json.result === undefined) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
  return json.result;
}

export interface ReplyKeyboard { keyboard: { text: string }[][]; resize_keyboard?: boolean; is_persistent?: boolean }

export async function sendMessage(chatId: number, text: string, replyTo?: number, keyboard?: ReplyKeyboard): Promise<void> {
  await call('sendMessage', {
    chat_id: chatId, text, disable_web_page_preview: true,
    ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });
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
  await call('setWebhook', { url, secret_token: secret, allowed_updates: ['message'], drop_pending_updates: false });
}

export async function getBotUsername(): Promise<string | null> {
  try {
    return (await call<{ username?: string }>('getMe', {})).username ?? null;
  } catch {
    return null;
  }
}

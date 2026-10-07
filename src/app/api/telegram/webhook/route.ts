import { after, NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { handleTelegramUpdate } from '@/server/bills/telegram-intake';
import { sendMessage, telegramConfigured, webhookSecret, type TelegramUpdate } from '@/server/integrations/telegram';

// Reading a bill with the AI can take a while; the work runs after the response.
export const maxDuration = 60;

function secretMatches(header: string | null): boolean {
  const expected = webhookSecret();
  if (!expected || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Telegram → bill inbox. Answers 200 at once so Telegram does not re-deliver while the AI reads. */
export async function POST(request: NextRequest) {
  if (!secretMatches(request.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  if (!admin || !telegramConfigured()) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }
  const origin = request.nextUrl.origin;
  after(async () => {
    try {
      await handleTelegramUpdate(admin, update, origin);
    } catch (err) {
      console.error('[telegram] update failed', update.update_id, err);
      const chat = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
      if (chat) await sendMessage(chat, 'ขออภัย ระบบรับบิลขัดข้อง ลองส่งใหม่อีกครั้งครับ').catch(() => undefined);
    }
  });
  return NextResponse.json({ ok: true });
}

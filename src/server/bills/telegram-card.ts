import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { billCardButtons, billCardText, type BillCard } from '@/domain/telegram';
import { sendMessage, telegramConfigured } from '@/server/integrations/telegram';

type Admin = SupabaseClient<Database>;

export async function loadCard(admin: Admin, billId: string): Promise<BillCard> {
  const { data, error } = await admin.rpc('bill_card', { p_id: billId });
  if (error || !data) throw new Error(`bill_card: ${error?.message ?? 'no data'}`);
  return data as unknown as BillCard;
}

/** Sends the bill card with its buttons. The app link is only useful to owners/managers (the page needs that role). */
export async function sendCard(
  chatId: number, card: BillCard, opts: { replyTo?: number; appOrigin?: string; manager?: boolean } = {},
): Promise<void> {
  const url = opts.manager && opts.appOrigin ? `${opts.appOrigin}/bills/${card.id}` : null;
  const buttons = billCardButtons(card, url);
  await sendMessage(chatId, billCardText(card), opts.replyTo, buttons.length ? { inline_keyboard: buttons } : undefined);
}

/**
 * Tells the submitter on Telegram that their bill changed (approved, rejected, cancelled, edited).
 * Best effort: the change is already committed and never depends on Telegram.
 */
export async function notifySubmitter(admin: Admin | null, billId: string): Promise<void> {
  if (!admin || !telegramConfigured()) return;
  try {
    const card = await loadCard(admin, billId);
    if (card.submitter_chat_id) await sendCard(card.submitter_chat_id, card);
  } catch (err) {
    console.error('[telegram] notify submitter failed', billId, err);
  }
}

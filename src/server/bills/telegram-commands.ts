import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppRole, BillStatus, Database } from '@/lib/database.types';
import { formatTHB } from '@/domain/money';
import { parseCommand, summaryText } from '@/domain/telegram';
export { parseCommand };
import { bangkokDate, formatDate } from '@/domain/datetime';
import { sendMessage, type ReplyKeyboard } from '@/server/integrations/telegram';
import { driveConfigured, driveFolderUrl } from '@/server/integrations/google-drive';

type Admin = SupabaseClient<Database>;
export interface Staff { employee_id: string; display_name: string; role: AppRole }

export const HELP = [
  'วิธีใช้บอทร้าน 🍮',
  '📷 ส่งรูปบิล/ใบเสร็จ → AI อ่านให้ (พิมพ์หมายเหตุใต้รูปได้)',
  '✍️ ไม่มีบิล: พิมพ์รายการตามด้วยยอด เช่น "ค่ากุ้งสด ปลาหมึก 1060" หรือ /jot ค่าน้ำแข็ง 40',
  'ทุกรายการรอผู้จัดการอนุมัติในแอป',
  '',
  '/menu เปิดเมนู · /latest รายการล่าสุด',
  '/today สรุปวันนี้ · /month สรุปเดือนนี้ (ผู้จัดการ)',
  '/drive ลิงก์ Google Drive (ผู้จัดการ)',
].join('\n');

const MENU: ReplyKeyboard = {
  keyboard: [[{ text: '/today' }, { text: '/month' }], [{ text: '/latest' }, { text: '/jot' }], [{ text: '/drive' }, { text: '/help' }]],
  resize_keyboard: true,
  is_persistent: true,
};

const isManager = (s: Staff) => s.role === 'OWNER' || s.role === 'MANAGER';
const STATUS: Record<BillStatus, string> = { PENDING: '⏳ รออนุมัติ', APPROVED: '✅ อนุมัติแล้ว', REJECTED: '❌ ไม่อนุมัติ' };
/**
 * Handles a bot command. Returns the expense text to submit for "/jot <text>",
 * or null when the command has been answered.
 */
export async function runCommand(
  admin: Admin, staff: Staff, cmd: { name: string; args: string },
  ctx: { chatId: number; telegramUserId: number; replyTo: number; appOrigin: string },
): Promise<string | null> {
  const reply = (text: string, keyboard?: ReplyKeyboard) => sendMessage(ctx.chatId, text, ctx.replyTo, keyboard);
  const managersOnly = () => reply('คำสั่งนี้สำหรับเจ้าของร้านและผู้จัดการ');

  switch (cmd.name) {
    case 'menu':
      await reply(`เลือกคำสั่งจากปุ่มด้านล่าง หรือส่งรูปบิลได้เลย`, MENU);
      return null;

    case 'jot': {
      if (!cmd.args) {
        await reply('พิมพ์รายการตามด้วยยอดเงินได้เลย เช่น\n/jot ค่าน้ำแข็ง 40\nหรือพิมพ์เฉยๆ ก็ได้: ค่ากุ้งสด ปลาหมึก 1060');
        return null;
      }
      if (cmd.args.startsWith('+')) {
        await reply('รายรับจากการขายบันทึกอัตโนมัติจากหน้าขายหน้าร้านแล้ว ตอนนี้บอทจดได้เฉพาะรายจ่ายครับ');
        return null;
      }
      return cmd.args;
    }

    case 'today':
    case 'month': {
      if (!isManager(staff)) { await managersOnly(); return null; }
      const today = bangkokDate();
      const from = cmd.name === 'today' ? today : `${today.slice(0, 8)}01`;
      const { data, error } = await admin.rpc('telegram_summary', { p_telegram_user_id: ctx.telegramUserId, p_from: from, p_to: today });
      if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`telegram_summary: ${error?.message ?? 'no data'}`);
      const title = cmd.name === 'today' ? `สรุปวันนี้ ${formatDate(today)}` : `สรุปเดือนนี้ ${formatDate(from)} – ${formatDate(today)}`;
      await reply(summaryText(title, data as Record<string, unknown>, ctx.appOrigin));
      return null;
    }

    case 'latest': {
      const { data, error } = await admin.rpc('telegram_latest_bills', { p_telegram_user_id: ctx.telegramUserId, p_limit: 5 });
      if (error) throw new Error(`telegram_latest_bills: ${error.message}`);
      if (!data?.length) { await reply('ยังไม่มีรายการ'); return null; }
      const lines = data.map((b) => [
        `${STATUS[b.status]} ${b.submission_number}`,
        `${b.vendor ?? b.message_text ?? '—'}${b.total !== null ? ` · ${formatTHB(b.total)}` : ''}`,
        isManager(staff) ? `โดย ${b.submitter_name} · ${ctx.appOrigin}/bills/${b.id}` : null,
        b.status === 'REJECTED' && b.review_note ? `เหตุผล: ${b.review_note}` : null,
        b.substitute_number ? `ใบรับรองแทนใบเสร็จ ${b.substitute_number}` : null,
      ].filter(Boolean).join('\n'));
      await reply(`🧾 รายการล่าสุด\n\n${lines.join('\n\n')}`);
      return null;
    }

    case 'drive': {
      if (!isManager(staff)) { await managersOnly(); return null; }
      if (!driveConfigured()) { await reply('ยังไม่ได้ตั้งค่า Google Drive (ตั้งค่าใน Vercel ตามคู่มือ)'); return null; }
      await reply(`📁 Google Drive ของร้าน\n${await driveFolderUrl()}\n(เปิดได้เฉพาะบัญชี Google เจ้าของโฟลเดอร์ หรือคนที่แชร์ให้)`);
      return null;
    }

    default:
      await reply(HELP, MENU);
      return null;
  }
}

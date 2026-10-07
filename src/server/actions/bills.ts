'use server';
import { z } from 'zod';
import { headers } from 'next/headers';
import { defineAction, ActionError } from '../action';
import { unwrap } from '../db';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { FRONT_OF_HOUSE, MANAGEMENT, OWNER_ONLY } from '@/domain/permissions';
import { approveBillSchema, billIdSchema, rejectBillSchema } from '@/domain/schemas/bills';
import { uuid } from '@/domain/schemas/common';
import { fileSubstituteReceipt } from '../bills/substitute';
import { getBill } from '../repositories/bills';
import { getBotUsername, setWebhook, telegramConfigured, TelegramError, webhookSecret } from '../integrations/telegram';
import { DriveError, driveConfigured } from '../integrations/google-drive';
import type { Json } from '@/lib/database.types';

export const approveBillAction = defineAction({
  input: approveBillSchema,
  roles: MANAGEMENT,
  revalidate: ['/bills', '/expenses', '/inventory'],
  handler: async (input) => {
    const db = await createSupabaseServerClient();
    const lines = input.lines.map((l) => ({
      description: l.description, amount: l.amount,
      ...(l.ingredient_id ? { ingredient_id: l.ingredient_id, quantity: l.quantity } : {}),
    }));
    const bill = unwrap(await db.rpc('approve_bill', {
      p_id: input.id, p_bill_date: input.bill_date, p_vendor: input.vendor ?? null, p_lines: lines as unknown as Json,
      p_category: input.category, p_payment_method: input.payment_method, p_from_drawer: input.from_drawer,
    }));
    // Filing to Drive happens after the approval is committed; a failure here never undoes it.
    let driveError: string | null = null;
    if (bill.substitute_number && driveConfigured()) {
      try {
        await fileSubstituteReceipt(db, bill);
      } catch (err) {
        driveError = err instanceof DriveError ? err.hint : err instanceof Error ? err.message : String(err);
      }
    }
    return { id: bill.id, substitute_number: bill.substitute_number, driveError };
  },
});

export const rejectBillAction = defineAction({
  input: rejectBillSchema,
  roles: MANAGEMENT,
  revalidate: ['/bills'],
  handler: async ({ id, reason }) => {
    const db = await createSupabaseServerClient();
    return unwrap(await db.rpc('reject_bill', { p_id: id, p_reason: reason })).id;
  },
});

export const fileSubstituteAction = defineAction({
  input: billIdSchema,
  roles: MANAGEMENT,
  revalidate: ['/bills'],
  handler: async ({ id }) => {
    const db = await createSupabaseServerClient();
    const bill = await getBill(db, id);
    if (!bill) throw new ActionError('NOT_FOUND');
    if (!driveConfigured()) throw new ActionError('Google Drive is not configured');
    try {
      return await fileSubstituteReceipt(db, bill);
    } catch (err) {
      throw new ActionError(err instanceof DriveError ? err.hint : err instanceof Error ? err.message : String(err));
    }
  },
});

export const createTelegramLinkAction = defineAction({
  input: z.object({}),
  roles: FRONT_OF_HOUSE,
  handler: async () => {
    if (!telegramConfigured()) throw new ActionError('TELEGRAM_BOT_TOKEN is not set');
    const db = await createSupabaseServerClient();
    const code = unwrap(await db.rpc('create_telegram_link_code', {}));
    const bot = await getBotUsername();
    return { code, url: bot ? `https://t.me/${bot}?start=${code}` : null, bot };
  },
});

export const unlinkTelegramAction = defineAction({
  input: z.object({ employee_id: uuid }),
  roles: FRONT_OF_HOUSE,
  revalidate: ['/telegram'],
  handler: async ({ employee_id }) => {
    const db = await createSupabaseServerClient();
    const { error } = await db.rpc('unlink_telegram', { p_employee_id: employee_id });
    if (error) unwrap({ data: null, error });
    return true;
  },
});

/** Points the bot at this deployment. The secret only needs to match between Telegram and the server. */
export const setTelegramWebhookAction = defineAction({
  input: z.object({}),
  roles: OWNER_ONLY,
  handler: async () => {
    const secret = webhookSecret();
    if (!telegramConfigured() || secret.length < 16) {
      throw new ActionError('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET (16+ characters) in Vercel first');
    }
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host) throw new ActionError('Unknown host');
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const url = `${proto}://${host}/api/telegram/webhook`;
    try {
      await setWebhook(url, secret);
    } catch (err) {
      throw new ActionError(err instanceof TelegramError ? err.hint : err instanceof Error ? err.message : String(err));
    }
    return { url, bot: await getBotUsername() };
  },
});

'use server';
import { z } from 'zod';
import { defineAction } from '../action';
import { unwrap } from '../db';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { FRONT_OF_HOUSE, OWNER_ONLY } from '@/domain/permissions';
import { journalSchema, signatureSchema } from '@/domain/accounting';
import { uuid } from '@/domain/schemas/common';
import type { Json } from '@/lib/database.types';

export const postJournalAction = defineAction({
  input: journalSchema,
  roles: OWNER_ONLY,
  revalidate: ['/accounting'],
  handler: async (input) => {
    const db = await createSupabaseServerClient();
    const lines = input.lines.map((l) => ({ account_code: l.account_code, debit: l.debit, credit: l.credit, note: l.note ?? null }));
    return unwrap(await db.rpc('post_journal', {
      p_entry_date: input.entry_date, p_memo: input.memo, p_lines: lines as unknown as Json, p_is_opening: input.is_opening,
    })).entry_number;
  },
});

export const reverseJournalAction = defineAction({
  input: z.object({ id: uuid }),
  roles: OWNER_ONLY,
  revalidate: ['/accounting'],
  handler: async ({ id }) => {
    const db = await createSupabaseServerClient();
    return unwrap(await db.rpc('reverse_journal', { p_id: id })).entry_number;
  },
});

export const saveSignatureAction = defineAction({
  input: signatureSchema,
  roles: FRONT_OF_HOUSE,
  revalidate: ['/signature'],
  handler: async ({ image }) => {
    const db = await createSupabaseServerClient();
    const { error } = await db.rpc('save_my_signature', { p_image: image });
    if (error) unwrap({ data: null, error });
    return true;
  },
});

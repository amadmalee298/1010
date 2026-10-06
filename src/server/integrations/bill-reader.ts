import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { billExtractionSchema, type BillExtraction } from '@/domain/bills';

/**
 * Reads a bill photo (or a typed expense message) with Claude and returns
 * structured lines. A manager always reviews the result before anything is
 * posted, so the reader only has to be a good first draft.
 */

export const billReaderConfigured = () => (process.env.ANTHROPIC_API_KEY ?? '').length > 0;

export interface IngredientHint { id: string; name: string; unit: string }

const SYSTEM = `You read purchase bills for a Thai dessert shop and return structured data.
- Copy item descriptions as written (keep Thai). One line per item; amounts are line totals in THB.
- If a line is clearly one of the shop's ingredients (list below), set ingredient_id and convert the quantity
  into that ingredient's unit in ingredient_quantity (1 กก. = 1000 กรัม, 1 ลิตร = 1000 มล., 1 แผง = 30 ฟอง unless the bill says otherwise).
  When unsure, leave ingredient_id null rather than guessing.
- Dates: return YYYY-MM-DD in the Gregorian calendar (Buddhist-era year minus 543).
- If the image is not a bill or receipt, set is_bill to false and return no lines.
- Put anything doubtful (unreadable amounts, totals that do not add up) in note, in Thai.`;

function ingredientList(ingredients: readonly IngredientHint[]): string {
  if (ingredients.length === 0) return 'The shop has no ingredients set up yet.';
  return `Shop ingredients (id | name | unit):\n${ingredients.map((i) => `${i.id} | ${i.name} | ${i.unit}`).join('\n')}`;
}

export type ReadResult = { ok: true; data: BillExtraction } | { ok: false; error: string };

export async function readBill(input: {
  image?: { data: Buffer; mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' };
  text?: string;
  ingredients: readonly IngredientHint[];
}): Promise<ReadResult> {
  if (!billReaderConfigured()) return { ok: false, error: 'ANTHROPIC_API_KEY is not set' };
  const client = new Anthropic({ timeout: 55_000, maxRetries: 1 });
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.image) {
    content.push({ type: 'image', source: { type: 'base64', media_type: input.image.mime, data: input.image.data.toString('base64') } });
  }
  content.push({
    type: 'text',
    text: input.image
      ? `Read this bill.${input.text ? ` The sender added: "${input.text}"` : ''}`
      : `There is no receipt for this expense. The sender typed: "${input.text ?? ''}". Turn it into bill lines (is_bill = true when it states what was bought and the amount).`,
  });
  try {
    const response = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(billExtractionSchema) },
      system: [
        { type: 'text', text: SYSTEM },
        { type: 'text', text: ingredientList(input.ingredients), cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content }],
    });
    if (response.stop_reason === 'refusal') return { ok: false, error: 'The AI declined to read this bill' };
    if (!response.parsed_output) return { ok: false, error: `Could not parse the AI answer (${response.stop_reason ?? 'unknown'})` };
    return { ok: true, data: response.parsed_output };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: 'ANTHROPIC_API_KEY is invalid' };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: 'AI rate limit — try again shortly' };
    if (err instanceof Anthropic.APIError) return { ok: false, error: `AI error ${err.status ?? ''}: ${err.message}` };
    return { ok: false, error: err instanceof Error ? err.message : 'AI request failed' };
  }
}

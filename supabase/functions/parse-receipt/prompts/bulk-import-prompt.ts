import { buildPrompt, buildSchema } from './receipt-prompt.ts';
import type { AiContext, BulkParseMode } from '../types.ts';

export function buildBulkPrompt(ctx: AiContext, forceReceipt = false): string {
  const classification = forceReceipt
    ? [
        'The user has confirmed that this document is a receipt. Parse it as document_kind="receipt".',
        'If required fields are unreadable, use document_kind="uncertain"; never invent them.',
      ]
    : [
        'First classify the whole document.',
        '- receipt: a cash-register receipt or an already-paid invoice with merchant, date, final paid total and item lines.',
        '- not_receipt: an unrelated document or an unpaid invoice/offer/reminder.',
        '- uncertain: it may be a receipt, but the evidence or required fields are too weak.',
      ];

  return [
    'This request belongs to an unattended bulk import.',
    ...classification,
    'Set classification_reason to one short sentence without sensitive details.',
    'For not_receipt or uncertain, return empty items, null article_count/article_count_raw_text and null store/date/total when not confidently visible.',
    'For a receipt, perform a row-by-row transcription before interpreting the values:',
    '- article_count: when the receipt prints a final article/item count such as "22 Artikel", copy that exact integer; otherwise null.',
    '- article_count_raw_text: copy the complete visible label and count that proves article_count; otherwise null.',
    '- Never derive article_count from emitted items, total_orig or an arithmetic gap. It is independent printed evidence.',
    '- total_raw_text: copy the complete printed amount-due label and amount verbatim.',
    '- source_ordinal: assign 1, 2, 3, ... to every emitted financial row in visual top-to-bottom order. Never reuse or skip a number.',
    '- raw_text: copy the shortest complete visible text fragment that proves product, quantity and price. Include a continuation line when it contains a multiplier, weight or line total.',
    '- A standalone multiplier line can be printed BETWEEN two product lines. Never attach it to the previous product merely because it appears immediately below it. Test both adjacent products: attach the multiplier only to the product whose separately printed line total equals count × unit price. Example: "Bread 2,99", then "2 x 1,79", then "Milk 3,58" means Bread qty=1 at 2,99 and Milk qty=2 at 1,79 because 2 × 1,79 = 3,58.',
    '- When using such a between-row multiplier, raw_text for the chosen product must contain both the multiplier line and that product line. The other product keeps only its own line and qty=1.',
    '- row_kind: item, discount, deposit, refund or cancellation.',
    '- qty_evidence: implicit_one unless the row visibly contains an explicit count multiplier (explicit_multiplier) or weight/volume calculation (weight_or_volume).',
    '- printed_line_total_orig: copy the row total when separately printed; otherwise null.',
    '- tax_class: copy a separate rightmost VAT class 1 or 2 when present; otherwise null. It never changes qty.',
    '- Verify each printed line total against qty × unit price, but report only what is visibly printed. Never invent a balancing row.',
    '- Count repeated identical rows separately. A missing repeated row is an extraction error even if adjacent text looks duplicated.',
    '- For every product-code + price combination repeated on the receipt, split the occurrences into visual runs separated by other products and sum the run lengths. Example: four X rows, then Y, then four X rows, then Z, then four X rows means twelve separate X items, not ten and not one item with qty=12.',
    '- Recount every repeated group once top-to-bottom and once bottom-to-top. The counts must agree. Derive the count only from visible physical rows, never from total_orig or an arithmetic gap.',
    '- Before returning, calculate the sum of the emitted financial rows and compare it with total_orig. If they differ, make one more visual sweep from the first financial row to the total: recount identical repeated rows and look specifically for a missed discount/refund, an unsupported quantity, or a row total mistaken for a unit price.',
    '- The second sweep is a verification pass, not permission to force agreement. Add or change a row only when its raw_text is independently visible in the document. If no visible row explains the difference, preserve the mismatch for review.',
    '',
    buildPrompt(ctx),
  ].join('\n');
}

export function buildBulkChunkPrompt(
  ctx: AiContext,
  forceReceipt: boolean,
  startOrdinal: number,
  maxItems: number,
): string {
  const endOrdinal = startOrdinal + maxItems - 1;
  return [
    'This is a bounded continuation pass for a receipt that cannot fit in one structured response.',
    `Count every physical financial row from the top of the original document, but emit only absolute source_ordinal ${String(startOrdinal)} through ${String(endOrdinal)}.`,
    `Emit exactly ${String(maxItems)} rows unless the printed receipt ends first. Do not emit rows before ${String(startOrdinal)} or silently skip a row inside the requested range.`,
    `Set chunk_start_ordinal=${String(startOrdinal)}. Set has_more=true only when another financial row is visibly printed after the last emitted row.`,
    'Repeat the same receipt metadata, printed total and printed article count on every chunk. Never derive them from the chunk subtotal.',
    'The source_ordinal values are absolute positions in the complete receipt, not positions within this chunk.',
    '',
    buildBulkPrompt(ctx, forceReceipt),
  ].join('\n');
}

export function buildBulkVerificationPrompt(ctx: AiContext, forceReceipt = false): string {
  return [
    'Perform a fresh verification transcription of the original document.',
    'You have not been given any previous extraction, mismatch amount or proposed correction.',
    'Before producing JSON, build a private physical-row ledger in visual order:',
    '1. Give every separately printed financial row exactly one ledger position. A duplicated-looking row is still a real row when it is visibly printed twice.',
    '2. For every product-code + price combination that occurs more than once, split its occurrences into visual runs separated by other products and count every run.',
    '3. Recount those runs once top-to-bottom and once bottom-to-top. The two counts must agree before emitting the items.',
    '4. Example: four X rows, then Y, then four X rows, then Z, then four X rows means twelve separate X items. Never emit ten, never collapse them, and never encode them as qty=12 unless the receipt itself prints an explicit multiplier.',
    '5. Derive every count only from visible physical rows. Never use the final total or arithmetic gap to infer a missing occurrence.',
    '6. Separately inspect the receipt summary for a printed article/item count. Transcribe it verbatim into article_count and article_count_raw_text; never calculate it from your ledger.',
    'Emit the complete receipt with one item and one consecutive source_ordinal per ledger row.',
    '',
    buildBulkPrompt(ctx, forceReceipt),
  ].join('\n');
}

export function buildBulkPromptForMode(
  ctx: AiContext,
  forceReceipt = false,
  mode: BulkParseMode = 'standard',
): string {
  return mode === 'verification'
    ? buildBulkVerificationPrompt(ctx, forceReceipt)
    : buildBulkPrompt(ctx, forceReceipt);
}

export function buildBulkSchema(ctx: AiContext): Record<string, unknown> {
  const receiptSchema = buildSchema(ctx) as {
    properties: Record<string, unknown> & {
      items: { type: string; items: { properties: Record<string, unknown>; required: string[] } };
    };
    required: string[];
  };
  const baseItem = receiptSchema.properties.items.items;
  const evidenceItems = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        ...baseItem.properties,
        source_ordinal: { type: 'integer', minimum: 1 },
        raw_text: { type: 'string' },
        row_kind: {
          type: 'string',
          enum: ['item', 'discount', 'deposit', 'refund', 'cancellation'],
        },
        qty_evidence: {
          type: 'string',
          enum: ['implicit_one', 'explicit_multiplier', 'weight_or_volume'],
        },
        printed_line_total_orig: { type: ['number', 'null'] },
        tax_class: { type: ['string', 'null'], enum: ['1', '2', null] },
      },
      required: [
        ...baseItem.required,
        'source_ordinal',
        'raw_text',
        'row_kind',
        'qty_evidence',
        'printed_line_total_orig',
        'tax_class',
      ],
    },
  };
  return {
    type: 'object',
    properties: {
      document_kind: { type: 'string', enum: ['receipt', 'not_receipt', 'uncertain'] },
      classification_reason: { type: 'string' },
      ...receiptSchema.properties,
      total_raw_text: { type: ['string', 'null'] },
      article_count: { type: ['integer', 'null'], minimum: 0 },
      article_count_raw_text: { type: ['string', 'null'] },
      items: evidenceItems,
    },
    required: [
      'document_kind',
      'classification_reason',
      'total_raw_text',
      'article_count',
      'article_count_raw_text',
      ...receiptSchema.required,
    ],
  };
}

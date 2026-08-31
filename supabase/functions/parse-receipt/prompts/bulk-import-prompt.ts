import { buildPrompt, buildSchema } from './receipt-prompt.ts';
import type { AiContext, BulkReceiptRepairContext } from '../types.ts';

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
    'For not_receipt or uncertain, return empty items and null store/date/total when not confidently visible.',
    '',
    buildPrompt(ctx),
  ].join('\n');
}

export function buildBulkSchema(ctx: AiContext): Record<string, unknown> {
  const receiptSchema = buildSchema(ctx) as {
    properties: Record<string, unknown>;
    required: string[];
  };
  return {
    type: 'object',
    properties: {
      document_kind: { type: 'string', enum: ['receipt', 'not_receipt', 'uncertain'] },
      classification_reason: { type: 'string' },
      ...receiptSchema.properties,
    },
    required: ['document_kind', 'classification_reason', ...receiptSchema.required],
  };
}

export function buildBulkRepairPrompt(ctx: AiContext, repair: BulkReceiptRepairContext): string {
  return [
    'Re-read the original receipt and repair only its extracted line items.',
    `The trusted printed final total is ${repair.expectedTotalOrig.toFixed(2)}.`,
    `The previous extracted items compute to ${repair.previousComputedTotal.toFixed(2)} after deterministic discount/cancellation pairing.`,
    'Return every physical item, deposit, refund, cancellation and discount row visible on the document.',
    'Return only the corrected items array required by the response schema.',
    '',
    'Safety rules:',
    '- The printed final total is fixed evidence. You cannot change it and the response schema intentionally does not expose it.',
    '- Never invent an adjustment, balancing, rounding or difference item to force the arithmetic to match.',
    '- Never alter a visible quantity or price merely to make the sum match; re-read the actual glyphs and row layout.',
    '- Count every separately printed repeated row, even when several consecutive rows are identical.',
    '- Keep negative Rabatt/Aktion/Preisanderung rows separate and copy the discounted product name as in the normal extraction rules.',
    '- On dm receipts, a rightmost 1 or 2 identified by the MwSt-Satz legend is a VAT class, not an item quantity.',
    '- Pack-size text such as 6x1.25l belongs to the product description. A separate deposit calculation such as 6 x 0.25 followed by Pfand 1.50 does not replace the merchandise price.',
    '- If a row cannot be read reliably, reproduce the visible rows conservatively; downstream validation will route unresolved arithmetic to human review.',
    '',
    'Previous extraction for comparison only:',
    JSON.stringify(repair.previousItems),
    '',
    buildPrompt(ctx),
  ].join('\n');
}

export function buildBulkRepairSchema(ctx: AiContext): Record<string, unknown> {
  const receiptSchema = buildSchema(ctx) as {
    properties: { items: unknown };
  };
  return {
    type: 'object',
    properties: { items: receiptSchema.properties.items },
    required: ['items'],
  };
}

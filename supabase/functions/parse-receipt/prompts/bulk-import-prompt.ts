import { buildPrompt, buildSchema } from './receipt-prompt.ts';
import type { AiContext } from '../types.ts';

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

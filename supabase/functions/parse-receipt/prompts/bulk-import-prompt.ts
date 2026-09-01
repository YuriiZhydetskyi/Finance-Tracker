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
    'For a receipt, perform a row-by-row transcription before interpreting the values:',
    '- total_raw_text: copy the complete printed amount-due label and amount verbatim.',
    '- source_ordinal: assign 1, 2, 3, ... to every emitted financial row in visual top-to-bottom order. Never reuse or skip a number.',
    '- raw_text: copy the shortest complete visible text fragment that proves product, quantity and price. Include a continuation line when it contains a multiplier, weight or line total.',
    '- row_kind: item, discount, deposit, refund or cancellation.',
    '- qty_evidence: implicit_one unless the row visibly contains an explicit count multiplier (explicit_multiplier) or weight/volume calculation (weight_or_volume).',
    '- printed_line_total_orig: copy the row total when separately printed; otherwise null.',
    '- tax_class: copy a separate rightmost VAT class 1 or 2 when present; otherwise null. It never changes qty.',
    '- Verify each printed line total against qty × unit price, but report only what is visibly printed. Never invent a balancing row.',
    '- Count repeated identical rows separately. A missing repeated row is an extraction error even if adjacent text looks duplicated.',
    '',
    buildPrompt(ctx),
  ].join('\n');
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
      items: evidenceItems,
    },
    required: [
      'document_kind',
      'classification_reason',
      'total_raw_text',
      ...receiptSchema.required,
    ],
  };
}

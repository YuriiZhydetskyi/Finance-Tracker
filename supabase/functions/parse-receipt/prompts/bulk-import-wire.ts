import type { AiContext, BulkParsedDocument, BulkReceiptChunk, ParsedItem } from '../types.ts';
import { buildBulkSchema } from './bulk-import-prompt.ts';

export const COMPACT_ITEM_FIELD_INSTRUCTIONS = [
  'The record_receipt tool uses compact aliases only inside each items object:',
  'n=product_name, p=product_code, q=qty, u=unit_price_orig, c=category_suggestion, d=discount_orig,',
  'o=source_ordinal, r=raw_text, k=row_kind, e=qty_evidence, l=printed_line_total_orig, t=tax_class.',
  'Populate every compact item field. Keep all top-level field names unchanged.',
].join('\n');

export function buildCompactBulkSchema(ctx: AiContext): Record<string, unknown> {
  return compactSchema(ctx, false);
}

export function buildCompactBulkChunkSchema(ctx: AiContext): Record<string, unknown> {
  return compactSchema(ctx, true);
}

export function expandCompactBulkDocument(value: unknown): BulkParsedDocument {
  return expandCompact(value) as BulkParsedDocument;
}

export function expandCompactBulkChunk(value: unknown): BulkReceiptChunk {
  return expandCompact(value) as BulkReceiptChunk;
}

function compactSchema(ctx: AiContext, chunk: boolean): Record<string, unknown> {
  const canonical = buildBulkSchema(ctx) as {
    properties: Record<string, unknown> & {
      items: { items: { properties: Record<string, unknown> } };
    };
    required: string[];
  };
  const item = canonical.properties.items.items.properties;
  const properties: Record<string, unknown> = {
    ...canonical.properties,
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: withDescription(item.product_name, 'Verbatim product_name.'),
          p: withDescription(item.product_code, 'Per-line product_code or null.'),
          q: withDescription(item.qty, 'Positive qty.'),
          u: withDescription(item.unit_price_orig, 'Signed unit_price_orig.'),
          c: withDescription(item.category_suggestion, 'Allowed category_suggestion or null.'),
          d: withDescription(
            item.discount_orig ?? { type: 'number' },
            'Per-unit discount_orig; normally 0.',
          ),
          o: withDescription(item.source_ordinal, 'Absolute 1-based source_ordinal.'),
          r: withDescription(item.raw_text, 'Shortest complete verbatim row evidence.'),
          k: withDescription(item.row_kind, 'Financial row_kind.'),
          e: withDescription(item.qty_evidence, 'Visible quantity evidence kind.'),
          l: withDescription(item.printed_line_total_orig, 'Printed line total or null.'),
          t: withDescription(item.tax_class, 'Rightmost VAT class or null.'),
        },
        required: ['n', 'p', 'q', 'u', 'c', 'd', 'o', 'r', 'k', 'e', 'l', 't'],
      },
    },
  };
  const required = [...canonical.required];
  if (chunk) {
    properties.chunk_start_ordinal = {
      type: 'integer',
      minimum: 1,
      description: 'Absolute ordinal of the first emitted financial row.',
    };
    properties.has_more = {
      type: 'boolean',
      description: 'True only when another financial row is visible after this chunk.',
    };
    required.push('chunk_start_ordinal', 'has_more');
  }
  return { type: 'object', properties, required };
}

function withDescription(value: unknown, description: string): Record<string, unknown> {
  return value && typeof value === 'object'
    ? { ...(value as Record<string, unknown>), description }
    : { description };
}

function expandCompact(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const row = value as Record<string, unknown>;
  return {
    ...row,
    items: Array.isArray(row.items) ? row.items.map(expandItem) : row.items,
  };
}

function expandItem(value: unknown): ParsedItem | unknown {
  if (!value || typeof value !== 'object') return value;
  const row = value as Record<string, unknown>;
  return {
    product_name: row.n,
    product_code: row.p,
    qty: row.q,
    unit_price_orig: row.u,
    category_suggestion: row.c,
    discount_orig: row.d,
    source_ordinal: row.o,
    raw_text: row.r,
    row_kind: row.k,
    qty_evidence: row.e,
    printed_line_total_orig: row.l,
    tax_class: row.t,
  } as ParsedItem;
}

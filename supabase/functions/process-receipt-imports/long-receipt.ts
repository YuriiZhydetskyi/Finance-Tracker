import type { BulkParsedDocument, BulkReceiptChunk, ParsedItem } from '../parse-receipt/types.ts';
import { validateBulkDocument } from './domain.ts';

export const LONG_RECEIPT_CHUNK_SIZE = 40;
export const LONG_RECEIPT_CHUNK_OVERLAP = 2;
export const MAX_RECEIPT_IMPORT_DELIVERIES = 12;

export function isLongReceiptRetryCode(code: string | null | undefined): boolean {
  return code === 'long_receipt_chunk_in_progress' || code === 'long_receipt_chunk_limit';
}

export function shouldStartLongReceiptChunks(
  stage: string | null | undefined,
  diagnosisCode: string | null | undefined,
  stopReason: string | null | undefined,
): boolean {
  if (stage === 'chunk_parse') return true;
  if (stage !== 'fallback_parse' && stage !== 'independent_check') return false;
  return stopReason === 'max_tokens' || diagnosisCode === 'timeout';
}

export function validateBulkReceiptChunk(
  value: unknown,
  requestedStart: number,
  maxItems = LONG_RECEIPT_CHUNK_SIZE,
): BulkReceiptChunk {
  if (!value || typeof value !== 'object') throw new Error('AI result is not an object');
  const row = value as Record<string, unknown>;
  if (row.chunk_start_ordinal !== requestedStart) {
    throw new Error('AI result chunk starts at an unexpected financial row');
  }
  if (typeof row.has_more !== 'boolean') {
    throw new Error('AI result chunk is missing its continuation marker');
  }
  const parsed = validateBulkDocument(row);
  if (parsed.document_kind !== 'receipt') {
    if (requestedStart !== 1 || parsed.items.length !== 0 || row.has_more) {
      throw new Error('AI result changed document classification during chunking');
    }
    return {
      ...parsed,
      chunk_start_ordinal: requestedStart,
      has_more: false,
    };
  }
  if (parsed.items.length === 0 || parsed.items.length > maxItems) {
    throw new Error('AI result chunk has an invalid number of financial rows');
  }
  if (row.has_more && parsed.items.length !== maxItems) {
    throw new Error('AI result chunk ended early despite reporting more financial rows');
  }
  parsed.items.forEach((item, index) => {
    if (item.source_ordinal !== requestedStart + index) {
      throw new Error('AI result chunk has a missing or duplicated source ordinal');
    }
  });
  return {
    ...parsed,
    chunk_start_ordinal: requestedStart,
    has_more: row.has_more,
  };
}

export function nextChunkStart(chunks: BulkReceiptChunk[]): number {
  if (chunks.length === 0) return 1;
  const last = chunks.at(-1)!;
  if (!last.has_more) throw new Error('AI result already contains the final receipt chunk');
  const lastOrdinal = last.items.at(-1)?.source_ordinal;
  if (lastOrdinal == null) throw new Error('AI result chunk has no final source ordinal');
  return Math.max(1, lastOrdinal - LONG_RECEIPT_CHUNK_OVERLAP + 1);
}

export function mergeBulkReceiptChunks(chunks: BulkReceiptChunk[]): BulkParsedDocument {
  if (chunks.length === 0) throw new Error('AI result has no receipt chunks to merge');
  const first = chunks[0]!;
  if (first.chunk_start_ordinal !== 1) {
    throw new Error('AI result receipt chunks do not start at the first financial row');
  }
  if (first.document_kind !== 'receipt') return validateBulkDocument(first);

  const mergedItems: ParsedItem[] = [];
  for (const [index, chunk] of chunks.entries()) {
    if (chunk.document_kind !== 'receipt' || !sameReceiptMetadata(first, chunk)) {
      throw new Error('AI result receipt chunks disagree on receipt metadata');
    }
    const expectedStart = index === 0 ? 1 : nextStartFromItems(mergedItems);
    if (chunk.chunk_start_ordinal !== expectedStart) {
      throw new Error('AI result receipt chunks are not contiguous');
    }
    for (const item of chunk.items) {
      const ordinal = item.source_ordinal;
      if (ordinal == null) throw new Error('AI result receipt chunk row lacks an ordinal');
      const existing = mergedItems[ordinal - 1];
      if (existing) {
        if (itemFingerprint(existing) !== itemFingerprint(item)) {
          throw new Error('AI result receipt chunk overlap disagrees');
        }
        continue;
      }
      if (ordinal !== mergedItems.length + 1) {
        throw new Error('AI result receipt chunks contain an ordinal gap');
      }
      mergedItems.push(item);
    }
    if (!chunk.has_more && index !== chunks.length - 1) {
      throw new Error('AI result has chunks after the declared end of receipt');
    }
  }
  if (chunks.at(-1)!.has_more) {
    throw new Error('AI result receipt chunks are incomplete');
  }
  return validateBulkDocument({ ...first, items: mergedItems });
}

function nextStartFromItems(items: ParsedItem[]): number {
  return Math.max(1, items.length - LONG_RECEIPT_CHUNK_OVERLAP + 1);
}

function sameReceiptMetadata(left: BulkParsedDocument, right: BulkParsedDocument): boolean {
  return (
    normalizeText(left.store) === normalizeText(right.store) &&
    normalizeText(left.store_address) === normalizeText(right.store_address) &&
    left.date === right.date &&
    (left.time ?? null) === (right.time ?? null) &&
    left.currency === right.currency &&
    sameAmount(left.total_orig, right.total_orig) &&
    (left.article_count ?? null) === (right.article_count ?? null) &&
    normalizeText(left.article_count_raw_text) === normalizeText(right.article_count_raw_text) &&
    normalizeText(left.total_raw_text) === normalizeText(right.total_raw_text)
  );
}

function itemFingerprint(item: ParsedItem): string {
  return JSON.stringify({
    product_name: normalizeText(item.product_name),
    product_code: item.product_code ?? null,
    qty: item.qty,
    unit_price_orig: item.unit_price_orig,
    category_suggestion: item.category_suggestion ?? null,
    discount_orig: item.discount_orig ?? 0,
    source_ordinal: item.source_ordinal,
    raw_text: normalizeText(item.raw_text),
    row_kind: item.row_kind,
    qty_evidence: item.qty_evidence,
    printed_line_total_orig: item.printed_line_total_orig ?? null,
    tax_class: item.tax_class ?? null,
  });
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de-DE');
}

function sameAmount(left: number | null, right: number | null): boolean {
  if (left == null || right == null) return left === right;
  return Math.abs(left - right) <= 0.01;
}

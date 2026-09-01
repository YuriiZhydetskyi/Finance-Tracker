import { describe, expect, it } from 'vitest';
import type { BulkReceiptChunk } from '../parse-receipt/types.ts';
import {
  LONG_RECEIPT_CHUNK_SIZE,
  isLongReceiptRetryCode,
  mergeBulkReceiptChunks,
  nextChunkStart,
  shouldStartLongReceiptChunks,
  validateBulkReceiptChunk,
} from './long-receipt.ts';

describe('long receipt chunk protocol', () => {
  it('starts chunk fallback only for a bounded Anthropic failure or an existing chunk', () => {
    expect(shouldStartLongReceiptChunks('fallback_parse', null, 'max_tokens')).toBe(true);
    expect(shouldStartLongReceiptChunks('independent_check', 'timeout', null)).toBe(true);
    expect(shouldStartLongReceiptChunks('chunk_parse', 'http_429', null)).toBe(true);
    expect(shouldStartLongReceiptChunks('fallback_parse', 'http_429', null)).toBe(false);
    expect(shouldStartLongReceiptChunks('primary_parse', 'timeout', null)).toBe(false);
    expect(isLongReceiptRetryCode('long_receipt_chunk_in_progress')).toBe(true);
    expect(isLongReceiptRetryCode('independent_check_failed')).toBe(false);
  });

  it('merges exact two-row overlaps into one canonical absolute-ordinal receipt', () => {
    const first = chunk(1, 40, true);
    const second = chunk(39, 45, false);

    expect(nextChunkStart([first])).toBe(39);
    const merged = mergeBulkReceiptChunks([first, second]);

    expect(merged.items).toHaveLength(45);
    expect(merged.items[0]?.source_ordinal).toBe(1);
    expect(merged.items.at(-1)?.source_ordinal).toBe(45);
    expect(merged.items[38]?.product_name).toBe('Item 39');
  });

  it('fails closed when a repeated overlap row changes between provider calls', () => {
    const first = chunk(1, 40, true);
    const second = chunk(39, 45, false);
    second.items[0] = { ...second.items[0]!, unit_price_orig: 99 };

    expect(() => mergeBulkReceiptChunks([first, second])).toThrow(
      'AI result receipt chunk overlap disagrees',
    );
  });

  it('rejects a short non-final chunk so the model cannot silently omit rows', () => {
    const value = { ...chunk(1, 39, false), has_more: true };

    expect(() => validateBulkReceiptChunk(value, 1, LONG_RECEIPT_CHUNK_SIZE)).toThrow(
      'AI result chunk ended early despite reporting more financial rows',
    );
  });

  it('rejects a chunk whose absolute ordinal does not match the requested continuation', () => {
    const value = chunk(39, 45, false);

    expect(() => validateBulkReceiptChunk(value, 40, LONG_RECEIPT_CHUNK_SIZE)).toThrow(
      'AI result chunk starts at an unexpected financial row',
    );
  });
});

function chunk(start: number, end: number, hasMore: boolean): BulkReceiptChunk {
  return validateBulkReceiptChunk(
    {
      document_kind: 'receipt',
      classification_reason: 'Long receipt',
      store: 'Store',
      store_address: 'Street 1',
      date: '2026-08-14',
      time: '20:44',
      currency: 'EUR',
      total_orig: 45,
      total_raw_text: 'SUMME 45,00',
      article_count: 45,
      article_count_raw_text: '45 Artikel',
      chunk_start_ordinal: start,
      has_more: hasMore,
      items: Array.from({ length: end - start + 1 }, (_, offset) => {
        const ordinal = start + offset;
        return {
          product_name: `Item ${String(ordinal)}`,
          product_code: String(ordinal),
          qty: 1,
          unit_price_orig: 1,
          category_suggestion: null,
          discount_orig: 0,
          source_ordinal: ordinal,
          raw_text: `Item ${String(ordinal)} 1,00`,
          row_kind: 'item',
          qty_evidence: 'implicit_one',
          printed_line_total_orig: 1,
          tax_class: '1',
        };
      }),
    },
    start,
    LONG_RECEIPT_CHUNK_SIZE,
  );
}

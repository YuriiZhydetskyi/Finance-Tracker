import { describe, it, expect } from 'vitest';
import type { PairDetectionResult, ParsedReceipt } from '@finance-tracker/domain';
import { hasUnsavedBatchItems } from './use-batch-leave-guard';
import type { BatchItem, BatchItemStatus } from './types';

function item(status: BatchItemStatus): BatchItem {
  return {
    id: 'i',
    fileName: 'receipt.jpg',
    source: 'file',
    blob: new Blob(),
    previewUrl: null,
    paidBy: 'me@example.com',
    attempts: 0,
    status,
  };
}

const parsed: ParsedReceipt = {
  store: 'Lidl',
  store_address: null,
  date: '2026-05-25',
  time: null,
  currency: 'EUR',
  total_orig: 1,
  items: [],
};
const pairResult: PairDetectionResult = { items: [] };

describe('hasUnsavedBatchItems', () => {
  it('is false for an empty batch', () => {
    expect(hasUnsavedBatchItems([])).toBe(false);
  });

  it('is false once everything is saved or parked in the retry queue', () => {
    expect(
      hasUnsavedBatchItems([
        item({ kind: 'saved', receipt_id: 'R1' }),
        item({ kind: 'archived', pendingId: 'P1' }),
      ]),
    ).toBe(false);
  });

  it.each<[string, BatchItemStatus]>([
    ['queued', { kind: 'queued' }],
    ['parsing', { kind: 'parsing' }],
    ['parsed', { kind: 'parsed', parsed, pairResult }],
    ['parse-error', { kind: 'parse-error', detail: { message: 'boom' } }],
  ])('is true while an item is %s', (_name, status) => {
    expect(hasUnsavedBatchItems([item({ kind: 'saved', receipt_id: 'R1' }), item(status)])).toBe(
      true,
    );
  });
});

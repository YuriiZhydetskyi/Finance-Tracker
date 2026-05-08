import { describe, it, expect } from 'vitest';
import type { ParsedReceipt, PairDetectionResult } from '@finance-tracker/domain';
import { batchReducer } from './batch-reducer';
import {
  initialBatchState,
  type BatchEnqueueInput,
  type BatchItem,
  type BatchState,
} from './types';

function makeEnqueueInput(id: string, suffix = ''): BatchEnqueueInput {
  return {
    id,
    fileName: `${id}.jpg`,
    blob: new Blob([id + suffix], { type: 'image/jpeg' }),
    previewUrl: `blob://${id}`,
  };
}

const fakeParsed: ParsedReceipt = {
  store: 'Lidl',
  date: '2026-05-04',
  currency: 'EUR',
  total_orig: 12.5,
  items: [],
};
const fakePairResult: PairDetectionResult = { items: [] };

function findItem(state: BatchState, id: string): BatchItem {
  const item = state.items.find((i) => i.id === id);
  if (!item) throw new Error(`Item ${id} not found`);
  return item;
}

describe('batchReducer', () => {
  describe('enqueued', () => {
    it('appends items in order with queued status, currentIndex 0 on first batch', () => {
      const state = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A'), makeEnqueueInput('B'), makeEnqueueInput('C')],
      });
      expect(state.items).toHaveLength(3);
      expect(state.items.map((i) => i.id)).toEqual(['A', 'B', 'C']);
      expect(state.items.every((i) => i.status.kind === 'queued')).toBe(true);
      expect(state.items.every((i) => i.attempts === 0)).toBe(true);
      expect(state.currentIndex).toBe(0);
    });

    it('preserves existing currentIndex when adding to non-empty list', () => {
      const initial: BatchState = {
        items: [
          {
            id: 'X',
            fileName: 'X.jpg',
            blob: new Blob(),
            previewUrl: '',
            attempts: 0,
            status: { kind: 'queued' },
          },
        ],
        currentIndex: 0,
      };
      const state = batchReducer(initial, {
        type: 'enqueued',
        items: [makeEnqueueInput('Y')],
      });
      expect(state.items).toHaveLength(2);
      expect(state.currentIndex).toBe(0);
    });

    it('is a no-op for empty input', () => {
      const state = batchReducer(initialBatchState, { type: 'enqueued', items: [] });
      expect(state).toBe(initialBatchState);
    });
  });

  describe('parseStart', () => {
    it('flips queued → parsing and increments attempts', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, { type: 'parseStart', id: 'A' });
      const item = findItem(s2, 'A');
      expect(item.status.kind).toBe('parsing');
      expect(item.attempts).toBe(1);
    });

    it('is a no-op for unknown id (zombie completion safety)', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, { type: 'parseStart', id: 'GHOST' });
      expect(s2).toEqual(s1);
    });

    it('does not transition non-queued items', () => {
      const initial: BatchState = {
        items: [
          {
            id: 'A',
            fileName: 'A.jpg',
            blob: new Blob(),
            previewUrl: '',
            attempts: 1,
            status: { kind: 'parsing' },
          },
        ],
        currentIndex: 0,
      };
      const next = batchReducer(initial, { type: 'parseStart', id: 'A' });
      expect(findItem(next, 'A').attempts).toBe(1);
    });
  });

  describe('parseSuccess', () => {
    it('flips parsing → parsed and stores parsed + pairResult', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, { type: 'parseStart', id: 'A' });
      const s3 = batchReducer(s2, {
        type: 'parseSuccess',
        id: 'A',
        parsed: fakeParsed,
        pairResult: fakePairResult,
      });
      const item = findItem(s3, 'A');
      expect(item.status.kind).toBe('parsed');
      if (item.status.kind === 'parsed') {
        expect(item.status.parsed).toBe(fakeParsed);
        expect(item.status.pairResult).toBe(fakePairResult);
      }
    });

    it('no-op for unknown id', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, {
        type: 'parseSuccess',
        id: 'GHOST',
        parsed: fakeParsed,
        pairResult: fakePairResult,
      });
      expect(s2).toEqual(s1);
    });
  });

  describe('parseError', () => {
    it('flips parsing → parse-error with message; attempts unchanged here', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, { type: 'parseStart', id: 'A' });
      const s3 = batchReducer(s2, { type: 'parseError', id: 'A', message: 'boom' });
      const item = findItem(s3, 'A');
      expect(item.status.kind).toBe('parse-error');
      if (item.status.kind === 'parse-error') {
        expect(item.status.message).toBe('boom');
      }
      expect(item.attempts).toBe(1);
    });

    it('only transitions from parsing (not from queued)', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, { type: 'parseError', id: 'A', message: 'x' });
      expect(findItem(s2, 'A').status.kind).toBe('queued');
    });
  });

  describe('retry', () => {
    it('flips parse-error → queued; attempts preserved (next parseStart will increment)', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, { type: 'parseStart', id: 'A' });
      const s3 = batchReducer(s2, { type: 'parseError', id: 'A', message: 'boom' });
      const s4 = batchReducer(s3, { type: 'retry', id: 'A' });
      const item = findItem(s4, 'A');
      expect(item.status.kind).toBe('queued');
      expect(item.attempts).toBe(1);

      const s5 = batchReducer(s4, { type: 'parseStart', id: 'A' });
      expect(findItem(s5, 'A').attempts).toBe(2);
    });

    it('is a no-op for items not in parse-error state', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, { type: 'retry', id: 'A' });
      expect(findItem(s2, 'A').status.kind).toBe('queued');
    });
  });

  describe('saveSuccess', () => {
    it('flips parsed → saved, clears blob and previewUrl', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, { type: 'parseStart', id: 'A' });
      const s3 = batchReducer(s2, {
        type: 'parseSuccess',
        id: 'A',
        parsed: fakeParsed,
        pairResult: fakePairResult,
      });
      const s4 = batchReducer(s3, { type: 'saveSuccess', id: 'A', receipt_id: 'R-123' });
      const item = findItem(s4, 'A');
      expect(item.status.kind).toBe('saved');
      if (item.status.kind === 'saved') {
        expect(item.status.receipt_id).toBe('R-123');
      }
      expect(item.blob.size).toBe(0);
      expect(item.previewUrl).toBe('');
    });

    it('only transitions from parsed', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, { type: 'saveSuccess', id: 'A', receipt_id: 'R-1' });
      expect(findItem(s2, 'A').status.kind).toBe('queued');
    });
  });

  describe('remove', () => {
    it('removes the item and shifts currentIndex when earlier item is removed', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A'), makeEnqueueInput('B'), makeEnqueueInput('C')],
      });
      const s2 = batchReducer(s1, { type: 'goto', index: 2 });
      const s3 = batchReducer(s2, { type: 'remove', id: 'A' });
      expect(s3.items.map((i) => i.id)).toEqual(['B', 'C']);
      expect(s3.currentIndex).toBe(1);
    });

    it('keeps currentIndex when removing a later item', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A'), makeEnqueueInput('B'), makeEnqueueInput('C')],
      });
      const s2 = batchReducer(s1, { type: 'goto', index: 0 });
      const s3 = batchReducer(s2, { type: 'remove', id: 'C' });
      expect(s3.items.map((i) => i.id)).toEqual(['A', 'B']);
      expect(s3.currentIndex).toBe(0);
    });

    it('clamps currentIndex when removing the last (current) item', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A'), makeEnqueueInput('B')],
      });
      const s2 = batchReducer(s1, { type: 'goto', index: 1 });
      const s3 = batchReducer(s2, { type: 'remove', id: 'B' });
      expect(s3.items.map((i) => i.id)).toEqual(['A']);
      expect(s3.currentIndex).toBe(0);
    });

    it('keeps currentIndex on removing the current middle item (next slides up)', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A'), makeEnqueueInput('B'), makeEnqueueInput('C')],
      });
      const s2 = batchReducer(s1, { type: 'goto', index: 1 });
      const s3 = batchReducer(s2, { type: 'remove', id: 'B' });
      expect(s3.items.map((i) => i.id)).toEqual(['A', 'C']);
      expect(s3.currentIndex).toBe(1);
    });

    it('handles removing the only item — index goes to 0, items empty', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, { type: 'remove', id: 'A' });
      expect(s2.items).toEqual([]);
      expect(s2.currentIndex).toBe(0);
    });

    it('no-op for unknown id', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, { type: 'remove', id: 'GHOST' });
      expect(s2).toEqual(s1);
    });
  });

  describe('goto', () => {
    it('clamps to upper bound', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A'), makeEnqueueInput('B')],
      });
      const s2 = batchReducer(s1, { type: 'goto', index: 99 });
      expect(s2.currentIndex).toBe(1);
    });

    it('clamps negative to 0', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, { type: 'goto', index: -5 });
      expect(s2.currentIndex).toBe(0);
    });
  });

  describe('reset', () => {
    it('returns to initial state', () => {
      const s1 = batchReducer(initialBatchState, {
        type: 'enqueued',
        items: [makeEnqueueInput('A')],
      });
      const s2 = batchReducer(s1, { type: 'reset' });
      expect(s2).toEqual(initialBatchState);
    });
  });
});

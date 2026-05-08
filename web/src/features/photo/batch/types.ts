import type { ParsedReceipt, PairDetectionResult } from '@finance-tracker/domain';

export type BatchItemStatus =
  | { kind: 'queued' }
  | { kind: 'parsing' }
  | { kind: 'parsed'; parsed: ParsedReceipt; pairResult: PairDetectionResult }
  | { kind: 'parse-error'; message: string }
  | { kind: 'saved'; receipt_id: string };

export type BatchItem = {
  id: string;
  fileName: string;
  blob: Blob;
  previewUrl: string;
  attempts: number;
  status: BatchItemStatus;
};

export type BatchState = {
  items: BatchItem[];
  currentIndex: number;
};

export type BatchEnqueueInput = {
  id: string;
  fileName: string;
  blob: Blob;
  previewUrl: string;
};

export type BatchAction =
  | { type: 'enqueued'; items: BatchEnqueueInput[] }
  | { type: 'parseStart'; id: string }
  | { type: 'parseSuccess'; id: string; parsed: ParsedReceipt; pairResult: PairDetectionResult }
  | { type: 'parseError'; id: string; message: string }
  | { type: 'retry'; id: string }
  | { type: 'saveSuccess'; id: string; receipt_id: string }
  | { type: 'remove'; id: string }
  | { type: 'goto'; index: number }
  | { type: 'reset' };

export const MAX_RETRY_ATTEMPTS = 2;

export const initialBatchState: BatchState = { items: [], currentIndex: 0 };

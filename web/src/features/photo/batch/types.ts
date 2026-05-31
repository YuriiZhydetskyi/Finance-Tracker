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
  source: 'file' | 'manual-json';
  blob: Blob;
  /** `null` for PDFs — no in-browser image preview. */
  previewUrl: string | null;
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
  previewUrl: string | null;
};

export type BatchAction =
  | { type: 'enqueued'; items: BatchEnqueueInput[] }
  | {
      type: 'manualParsed';
      id: string;
      fileName: string;
      parsed: ParsedReceipt;
      pairResult: PairDetectionResult;
    }
  | { type: 'parseStart'; id: string }
  | { type: 'parseSuccess'; id: string; parsed: ParsedReceipt; pairResult: PairDetectionResult }
  | { type: 'parseError'; id: string; message: string }
  | { type: 'retry'; id: string }
  | { type: 'saveSuccess'; id: string; receipt_id: string }
  | { type: 'remove'; id: string }
  | { type: 'goto'; index: number }
  | { type: 'reset' };

export const MAX_RETRY_ATTEMPTS = 2;

export const PASTED_JSON_LABEL = 'Pasted AI JSON';

export const initialBatchState: BatchState = { items: [], currentIndex: 0 };

import type { ParsedReceipt, PairDetectionResult } from '@finance-tracker/domain';
import type { ErrorDetail } from '@/shared/utils/error-details';

export type BatchItemStatus =
  | { kind: 'queued' }
  | { kind: 'parsing' }
  | { kind: 'parsed'; parsed: ParsedReceipt; pairResult: PairDetectionResult }
  | { kind: 'parse-error'; detail: ErrorDetail }
  | { kind: 'archived'; pendingId: string }
  | { kind: 'saved'; receipt_id: string };

export type BatchItem = {
  id: string;
  fileName: string;
  source: 'file' | 'manual-json';
  blob: Blob;
  /** `null` for PDFs — no in-browser image preview. */
  previewUrl: string | null;
  /**
   * Who paid — captured up-front (per photo) so a failed parse can be queued
   * with the payer already known. Empty string for manual-json (the review
   * form falls back to the current user). Pre-fills the review form's paid_by.
   */
  paidBy: string;
  /**
   * Present when this item was hydrated from the failed-parse queue. On save
   * the receipt reuses `photoPath` (no re-upload) and the queue row `id` is
   * deleted; on repeated failure the row's attempts are bumped instead of
   * creating a new row.
   */
  pendingParse?: { id: string; photoPath: string };
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
  paidBy: string;
};

export type HydratePendingInput = {
  id: string;
  fileName: string;
  blob: Blob;
  previewUrl: string | null;
  paidBy: string;
  pendingParse: { id: string; photoPath: string };
};

export type ManualParsedInput = {
  id: string;
  fileName: string;
  parsed: ParsedReceipt;
  pairResult: PairDetectionResult;
};

export type BatchAction =
  | { type: 'enqueued'; items: BatchEnqueueInput[] }
  | { type: 'hydratePending'; items: HydratePendingInput[] }
  | { type: 'manualParsedMany'; items: ManualParsedInput[] }
  | { type: 'parseStart'; id: string }
  | { type: 'parseSuccess'; id: string; parsed: ParsedReceipt; pairResult: PairDetectionResult }
  | { type: 'parseError'; id: string; detail: ErrorDetail }
  | { type: 'retry'; id: string }
  | { type: 'archiveSuccess'; id: string; pendingId: string }
  | { type: 'saveSuccess'; id: string; receipt_id: string }
  | { type: 'remove'; id: string }
  | { type: 'goto'; index: number }
  | { type: 'reset' };

export const MAX_RETRY_ATTEMPTS = 2;

export const PASTED_JSON_LABEL = 'Pasted AI JSON';

export const initialBatchState: BatchState = { items: [], currentIndex: 0 };

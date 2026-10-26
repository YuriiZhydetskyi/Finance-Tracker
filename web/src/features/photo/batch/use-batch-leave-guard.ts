import { useLeaveGuard } from '@/shared/hooks/use-leave-guard';
import type { BatchItem } from './types';

const BATCH_LEAVE_MESSAGE =
  'Не всі чеки з пачки збережено. Якщо вийти зараз, розпізнані дані буде втрачено. Вийти?';

/**
 * Parsed receipts, queued photos and failed parses exist only in the batch
 * reducer, so leaving the page drops them. Saved and queue-archived items are
 * already persisted and do not count.
 */
export function hasUnsavedBatchItems(items: BatchItem[]): boolean {
  return items.some((item) => item.status.kind !== 'saved' && item.status.kind !== 'archived');
}

export function useBatchLeaveGuard(items: BatchItem[]): void {
  useLeaveGuard(hasUnsavedBatchItems(items), BATCH_LEAVE_MESSAGE);
}

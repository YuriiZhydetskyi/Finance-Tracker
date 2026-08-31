import { useMemo } from 'react';
import { addDaysIso, DATE_WINDOW_DAYS, type NormalizedStatementTxn } from '@finance-tracker/domain';
import { useReceipts } from '@/features/receipts';

// Cap on receipts pulled for one statement's date range. Generous — a statement
// spans days/weeks, not a heavy user's full history. Revisit with pagination if hit.
const FETCH_LIMIT = 1000;

// Fetch range = [earliest txn date − window, latest txn date]. The lower padding
// covers card posting lag (a purchase on day D can post up to `window` days later,
// so the receipt's date is earlier than the statement date).
function statementRange(txns: NormalizedStatementTxn[]): { from: string; to: string } | null {
  const dates = txns.map((t) => t.date).sort((left, right) => left.localeCompare(right));
  const min = dates[0];
  const max = dates[dates.length - 1];
  if (!min || !max) return null;
  return { from: addDaysIso(min, -DATE_WINDOW_DAYS), to: max };
}

/**
 * Fetches all receipts in the statement's date range (RLS-filtered to the user)
 * by reusing the receipts query with date filters. Disabled until there are
 * transactions, so landing on the page fetches nothing. Sharing `useReceipts`
 * means the reassign mutation's `receiptsQueryKey` invalidation refreshes it too.
 */
export function useStatementReceipts(txns: NormalizedStatementTxn[]) {
  const range = useMemo(() => statementRange(txns), [txns]);
  return useReceipts(range ? { dateFrom: range.from, dateTo: range.to } : undefined, FETCH_LIMIT, {
    enabled: range != null,
  });
}

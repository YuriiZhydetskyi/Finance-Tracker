import { queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import { roundMoney } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { receiptsQueryKey } from './receipts-query-keys';

export type DuplicateCandidate = {
  id: string;
  store: string;
  date: string;
  time: string | null;
  total_orig: number;
  currency: string;
};

export type DuplicateCheckInput = {
  store: string | null | undefined;
  date: string | null | undefined;
  total_orig: number | null | undefined;
  // HH:MM (form value) or HH:MM:SS (echoed back from DB); both accepted.
  time: string | null | undefined;
  // Set when editing — exclude the receipt itself from its own dedup query.
  excludeId?: string | null;
};

const TOTAL_TOLERANCE = 0.01;
const TIME_WINDOW_MINUTES = 10;

export function duplicateReceiptsQueryOptions(input: DuplicateCheckInput) {
  const { store, date, total_orig, excludeId } = input;

  return queryOptions({
    queryKey: [...receiptsQueryKey, 'duplicates', input] as const,
    staleTime: 30_000,
    queryFn:
      store?.trim() && date && typeof total_orig === 'number' && total_orig !== 0
        ? async ({ signal }): Promise<DuplicateCandidate[]> => {
            const lo = roundMoney(total_orig - TOTAL_TOLERANCE);
            const hi = roundMoney(total_orig + TOTAL_TOLERANCE);
            // Filters first, then ordering + limit. PostgREST is order-agnostic but
            // chaining .neq after .limit confuses some thenable implementations.
            let q = supabase
              .from('receipts')
              .select('id, store, date, time, total_orig, currency')
              .eq('store', store)
              .eq('date', date)
              .gte('total_orig', lo)
              .lte('total_orig', hi);
            if (excludeId) q = q.neq('id', excludeId);
            const { data, error } = await q
              .order('created_at', { ascending: false })
              .limit(3)
              .abortSignal(signal);
            if (error) throw error;
            return (data ?? []).filter((row) => withinTimeWindow(row.time, input.time));
          }
        : skipToken,
  });
}

/**
 * Reactively searches for receipts that look like the one currently being
 * entered — same store, same date, total within ±0.01, and (if both have time)
 * within 10 minutes. Used to show a soft duplicate warning in the review form.
 *
 * Returns at most 3 candidates ordered by most recently created.
 */
export function useDuplicateReceipts(input: DuplicateCheckInput) {
  return useQuery(duplicateReceiptsQueryOptions(input));
}

// Both null/missing → keep candidate (no time signal). Both present → must be
// within TIME_WINDOW_MINUTES; otherwise the two receipts are different
// transactions at the same store/day.
export function withinTimeWindow(
  candidateTime: string | null,
  inputTime: string | null | undefined,
): boolean {
  if (!candidateTime || !inputTime) return true;
  const a = toMinutes(candidateTime);
  const b = toMinutes(inputTime);
  if (a == null || b == null) return true;
  return Math.abs(a - b) <= TIME_WINDOW_MINUTES;
}

function toMinutes(t: string): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

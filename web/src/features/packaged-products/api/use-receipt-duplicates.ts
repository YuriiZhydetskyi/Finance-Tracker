// Best-effort check for the receipt on the PDF's receipt pages: is a receipt with the
// same date, store and total already stored? It only warns. The import queue runs its
// own duplicate gate on the parsed receipt, and nothing here ever blocks a save.

import { queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import { roundMoney } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import type { PackagingReceiptSummary } from '../utils/packaging-import';
import { storesLookAlike } from '../utils/packaging-receipt';

export type StoredReceiptMatch = {
  id: string;
  store: string;
  date: string;
  total_orig: number;
  currency: string;
};

const TOTAL_TOLERANCE = 0.01;

export function packagingReceiptDuplicatesQueryOptions(summary: PackagingReceiptSummary | null) {
  const { store, date, total } = summary ?? { store: null, date: null, total: null };

  return queryOptions({
    queryKey: ['packaging-receipt-duplicates', store, date, total] as const,
    staleTime: 30_000,
    queryFn:
      store && date && total != null
        ? async ({ signal }): Promise<StoredReceiptMatch[]> => {
            // The date and total narrow the query; the store is compared in the
            // browser because the transcriber's spelling rarely equals the stored one.
            const { data, error } = await supabase
              .from('receipts')
              .select('id, store, date, total_orig, currency')
              .eq('date', date)
              .gte('total_orig', roundMoney(total - TOTAL_TOLERANCE))
              .lte('total_orig', roundMoney(total + TOTAL_TOLERANCE))
              .limit(20)
              .abortSignal(signal);
            if (error) throw error;
            return (data ?? []).filter((row) => storesLookAlike(row.store, store));
          }
        : skipToken,
  });
}

/** Stored receipts that look like the one on the PDF; stays idle without a date, store and total. */
export function usePackagingReceiptDuplicates(summary: PackagingReceiptSummary | null) {
  return useQuery(packagingReceiptDuplicatesQueryOptions(summary));
}

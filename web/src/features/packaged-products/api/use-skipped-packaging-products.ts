// Store rows marked «Без упаковки», so a wrong flag can be undone (ADR-0034).
// A plain table read: the flag and its reason live on `products`, and RLS applies.

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import { packagingCandidatesQueryKey } from './packaged-products-query-keys';
import type { SkippedPackagingProductRow } from '../types';

const COLUMNS =
  'id, name, store, store_product_code, category, brand, packaging_not_applicable_reason';
// PostgREST caps a response at 1000 rows.
const ROW_LIMIT = 1000;

// Under the queue's key, so every mutation that refreshes the queue refreshes this too.
export const skippedPackagingProductsQueryKey = [
  ...packagingCandidatesQueryKey,
  'skipped',
] as const;

export function skippedPackagingProductsQueryOptions() {
  return queryOptions({
    queryKey: skippedPackagingProductsQueryKey,
    staleTime: 60_000,
    queryFn: async ({ signal }): Promise<SkippedPackagingProductRow[]> => {
      const { data, error } = await supabase
        .from('products')
        .select(COLUMNS)
        .eq('packaging_not_applicable', true)
        .order('store')
        .order('name')
        .limit(ROW_LIMIT)
        .abortSignal(signal);
      if (error) throw wrapError('Не вдалося прочитати позиції без упаковки', error);
      return data ?? [];
    },
  });
}

export function useSkippedPackagingProducts({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    ...skippedPackagingProductsQueryOptions(),
    enabled,
    placeholderData: keepPreviousData,
  });
}

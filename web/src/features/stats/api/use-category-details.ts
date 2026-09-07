import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { summarizeCategoryDetails, type StatsDetailItem } from '../category-details';
import type { StatsDateRange, StatsFilters } from './stats.types';

async function fetchCategoryDetailsPage(
  range: StatsDateRange,
  filters: StatsFilters,
  afterId: string | undefined,
  signal: AbortSignal,
) {
  let query = supabase
    .from('items')
    .select(
      'id, receipt_id, category, product_name, total_eur, product_family_id, family:product_families!items_product_family_id_fkey(name_uk), receipt:receipts!inner(date, store)',
    )
    .order('id')
    .limit(500);
  if (afterId) query = query.gt('id', afterId);
  if (range.dateFrom) query = query.gte('receipt.date', range.dateFrom);
  if (range.dateTo) query = query.lte('receipt.date', range.dateTo);
  if (filters.categories) query = query.in('category', filters.categories);
  if (filters.stores) query = query.in('receipt.store', filters.stores);
  const { data: rawData, error } = await query.abortSignal(signal);
  if (error) throw error;
  return (rawData ?? []) as unknown as StatsDetailItem[];
}

export function useCategoryDetails(range: StatsDateRange, filters: StatsFilters, enabled: boolean) {
  return useQuery({
    queryKey: ['stats', 'category-details', range, filters],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => {
      const items: StatsDetailItem[] = [];
      if (filters.categories?.length === 0 || filters.stores?.length === 0) {
        return summarizeCategoryDetails(items);
      }
      let afterId: string | undefined;
      // Keyset pagination also handles a server row cap smaller than the requested page.
      for (;;) {
        const data = await fetchCategoryDetailsPage(range, filters, afterId, signal);
        if (data.length === 0) break;
        items.push(...data);
        afterId = data.at(-1)?.id;
      }
      return summarizeCategoryDetails(items);
    },
  });
}

import { useQuery } from '@tanstack/react-query';
import { storeNamesMatch } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';

// How many recent receipts to scan for a category suggestion. Fuzzy store match
// can't run in SQL, so we pull a bounded recent slice and match client-side.
const LOOKBACK_LIMIT = 300;

/**
 * Suggests a category for a stub receipt by learning from history: among recent
 * receipts whose store fuzzy-matches the statement merchant/raw (same
 * `storeNamesMatch` as reconciliation), returns the most frequent item category.
 * Returns null when there's nothing comparable. Self-improving — once McDonald's
 * is categorized once (stub or real receipt), the next stub defaults to it.
 */
export function useSuggestedCategory(merchant: string | null, raw: string | null) {
  const probe = (merchant ?? raw ?? '').trim();
  return useQuery<string | null>({
    queryKey: ['suggested-category', merchant, raw],
    enabled: probe !== '',
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('receipts')
        .select('store, items(category)')
        .order('date', { ascending: false })
        .limit(LOOKBACK_LIMIT);
      if (error) throw error;

      const counts = new Map<string, number>();
      for (const receipt of data ?? []) {
        if (!storeNamesMatch(merchant, raw, receipt.store)) continue;
        for (const item of receipt.items) {
          counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
        }
      }

      let best: string | null = null;
      let bestCount = 0;
      for (const [category, count] of counts) {
        if (count > bestCount) {
          best = category;
          bestCount = count;
        }
      }
      return best;
    },
  });
}

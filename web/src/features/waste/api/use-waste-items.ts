import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';

// Items joined with receipts for the /waste page. Filters are applied
// server-side via PostgREST. The "fully wasted" toggle is applied
// client-side after fetch because PostgREST doesn't expose `qty - wasted_qty`
// as a filterable expression and we don't want a dedicated SQL view for it.

export type WasteFilters = {
  nameSearch?: string; // ILIKE %name% on items.product_name
  category?: string; // exact match on items.category
  dateFrom?: string; // YYYY-MM-DD lower bound on receipts.date
  dateTo?: string; // YYYY-MM-DD upper bound on receipts.date
  storeSearch?: string; // ILIKE %store% on receipts.store
  priceMin?: number; // inclusive lower bound on items.total_orig
  priceMax?: number; // inclusive upper bound on items.total_orig
  // When false (default), items where wasted_qty == qty are hidden.
  // When true, all items pass through regardless of state.
  showFullyWasted: boolean;
};

export type WasteItemRow = {
  id: string;
  product_name: string;
  category: string;
  qty: number;
  unit_price_orig: number;
  total_orig: number;
  total_eur: number;
  discount_orig: number;
  wasted_qty: number;
  wasted_at: string | null;
  receipt: {
    id: string;
    date: string;
    store: string;
    currency: string;
    fx_rate_eur: number;
  };
};

const DEFAULT_LIMIT = 200;

export const wasteItemsQueryKey = ['waste-items'] as const;

/**
 * Items eligible to be marked as spoilage, sorted by purchase date desc.
 * Cancellation/Pfand-refund rows (total_orig <= 0) are excluded server-side.
 * The PostgREST `!inner` join makes receipt filters (date/store) NOT NULL —
 * items orphaned from their receipt would be filtered out, but that should
 * never happen with our FK.
 */
export function useWasteItems(filters: WasteFilters, limit = DEFAULT_LIMIT) {
  return useQuery<WasteItemRow[]>({
    queryKey: [...wasteItemsQueryKey, { filters, limit }] as const,
    queryFn: async () => {
      let q = supabase
        .from('items')
        .select(
          `
          id, product_name, category, qty, unit_price_orig, total_orig, total_eur,
          discount_orig, wasted_qty, wasted_at,
          receipt:receipts!inner(id, date, store, currency, fx_rate_eur)
        `,
        )
        .gt('total_orig', 0);

      if (filters.nameSearch) q = q.ilike('product_name', `%${filters.nameSearch}%`);
      if (filters.category) q = q.eq('category', filters.category);
      if (filters.dateFrom) q = q.gte('receipts.date', filters.dateFrom);
      if (filters.dateTo) q = q.lte('receipts.date', filters.dateTo);
      if (filters.storeSearch) q = q.ilike('receipts.store', `%${filters.storeSearch}%`);
      if (filters.priceMin != null) q = q.gte('total_orig', filters.priceMin);
      if (filters.priceMax != null) q = q.lte('total_orig', filters.priceMax);

      const { data, error } = await q
        .order('date', { referencedTable: 'receipts', ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      const rows = (data ?? []) as unknown as WasteItemRow[];
      // Hide fully-wasted unless explicitly opted in. Cheap client-side filter:
      // there is no PostgREST expression for `wasted_qty == qty`.
      return filters.showFullyWasted ? rows : rows.filter((r) => r.wasted_qty < r.qty);
    },
    staleTime: 30_000,
  });
}

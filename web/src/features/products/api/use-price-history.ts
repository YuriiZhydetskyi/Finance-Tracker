import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';

export type PricePoint = {
  date: string;
  price_orig: number;
  price_net: number;
  currency: string;
};

export const priceHistoryQueryKey = (productId: string) =>
  ['products', 'price-history', productId] as const;

/** Full price history for one product, oldest → newest, for the trend chart. */
export function usePriceHistory(productId: string) {
  return useQuery<PricePoint[]>({
    queryKey: priceHistoryQueryKey(productId),
    enabled: productId.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_prices')
        .select('date, price_orig, price_net, currency')
        .eq('product_id', productId)
        .order('date', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        date: p.date,
        price_orig: p.price_orig,
        price_net: p.price_net,
        currency: p.currency,
      }));
    },
    staleTime: 60_000,
  });
}

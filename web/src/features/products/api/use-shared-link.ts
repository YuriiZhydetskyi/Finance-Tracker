import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { generateShareToken } from '../lib/share-token';
import type { PricePoint } from './use-price-history';

export type SharedLink = {
  token: string;
  product_id: string;
  view_count: number;
  snapshot: PricePoint[];
};

export const sharedLinkQueryKey = (token: string) => ['shared-link', token] as const;

/** Resolve a shared link by token and bump its view counter. */
export function useSharedLink(token: string) {
  return useQuery<SharedLink | null>({
    queryKey: sharedLinkQueryKey(token),
    enabled: token.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shared_links')
        .select('token, product_id, view_count, snapshot')
        .eq('token', token)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      await supabase
        .from('shared_links')
        .update({ view_count: data.view_count + 1 })
        .eq('token', token);

      return {
        token: data.token,
        product_id: data.product_id,
        view_count: data.view_count,
        snapshot: JSON.parse(data.snapshot) as PricePoint[],
      };
    },
  });
}

/** Create a shareable link for a product's current price history. */
export function useCreateShareLinkMutation() {
  const queryClient = useQueryClient();
  return useMutation<string, Error, { productId: string; points: PricePoint[] }>({
    mutationFn: async ({ productId, points }) => {
      const token = generateShareToken();
      const { error } = await supabase
        .from('shared_links')
        .insert({ token, product_id: productId, snapshot: JSON.stringify(points) });
      if (error) throw new Error(error.message);
      return token;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['shared-link'] });
    },
  });
}

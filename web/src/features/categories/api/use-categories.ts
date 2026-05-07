import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';

export type Category = { name: string; group_name: string };

export const categoriesQueryKey = ['categories'] as const;

/** Returns all categories ordered by group then name. RLS-filtered. */
export function useCategories() {
  return useQuery<Category[]>({
    queryKey: categoriesQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('name, group_name')
        .order('group_name')
        .order('name');
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

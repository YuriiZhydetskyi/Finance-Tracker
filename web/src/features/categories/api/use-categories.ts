import { queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';

export type Category = { name: string; group_name: string };

export const categoriesQueryKey = ['categories'] as const;

const NO_NAMES: string[] = [];

const selectCategoryNames = (categories: Category[]) => categories.map((c) => c.name);

export const categoriesQueryOptions = queryOptions({
  queryKey: categoriesQueryKey,
  queryFn: async (): Promise<Category[]> => {
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

/** Returns all categories ordered by group then name. RLS-filtered. */
export function useCategories() {
  return useQuery(categoriesQueryOptions);
}

/**
 * Category names only, in the same order. The array keeps its identity until the
 * category list changes, so it is safe as an effect or memo dependency.
 */
export function useCategoryNames(): string[] {
  const { data } = useQuery({ ...categoriesQueryOptions, select: selectCategoryNames });
  return data ?? NO_NAMES;
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import { categoriesQueryKey, type Category } from './use-categories';

export type CreateCategoryVars = { name: string; group_name: string };

export function useCreateCategoryMutation() {
  const queryClient = useQueryClient();

  return useMutation<Category, Error, CreateCategoryVars>({
    mutationFn: async ({ name, group_name }) => {
      const trimmed_name = name.trim();
      const trimmed_group = group_name.trim();
      if (!trimmed_name) throw new Error('Назва категорії обов’язкова');
      if (!trimmed_group) throw new Error('Група обов’язкова');

      const { data, error } = await supabase
        .from('categories')
        .insert({ name: trimmed_name, group_name: trimmed_group })
        .select('name, group_name')
        .single();
      if (error) throw wrapError('Category insert failed', error);
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: categoriesQueryKey });
    },
  });
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { makeStoreAlias, type StoreAliasInput } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import { storeAliasesQueryKey } from './store-aliases-query-keys';

/**
 * Persists statement↔store name pairs the user just confirmed (a match whose
 * names did not fuzzy-match). Upserts on the unique normalized pair with
 * `ignoreDuplicates` so re-confirming is a no-op. Callers fire-and-forget: a
 * failed alias save must never block the apply/link it piggybacks on.
 */
export function useSaveStoreAliasesMutation() {
  const queryClient = useQueryClient();

  return useMutation<number, Error, StoreAliasInput[]>({
    mutationFn: async (inputs) => {
      if (inputs.length === 0) return 0;
      const rows = inputs.map(makeStoreAlias);
      const { error } = await supabase
        .from('store_aliases')
        .upsert(rows, { onConflict: 'statement_name,receipt_store', ignoreDuplicates: true });
      if (error) throw wrapError('Не вдалося зберегти відповідності назв магазинів', error);
      return rows.length;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: storeAliasesQueryKey });
    },
  });
}

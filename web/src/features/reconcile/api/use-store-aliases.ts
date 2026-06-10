import { useQuery } from '@tanstack/react-query';
import { makeStoreAliasKey } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { storeAliasesQueryKey } from './store-aliases-query-keys';

/**
 * Learned statement↔receipt store-name pairs as a lookup Set in the
 * makeStoreAliasKey format `reconcileStatement` consumes via
 * `options.storeAliasKeys`. Rows are stored normalized; re-keying through
 * makeStoreAliasKey is idempotent and keeps the format in one place.
 */
export function useStoreAliases() {
  return useQuery<ReadonlySet<string>>({
    queryKey: storeAliasesQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('store_aliases')
        .select('statement_name, receipt_store');
      if (error) throw error;
      return new Set(data.map((r) => makeStoreAliasKey(r.statement_name, r.receipt_store)));
    },
    staleTime: 60_000,
  });
}

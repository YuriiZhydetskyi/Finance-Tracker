import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { receiptQueryKey, receiptsQueryKey } from './receipts-query-keys';

export type DeleteReceiptVars = { id: string };

/**
 * Deletes a receipt; child items cascade via FK (`on delete cascade`).
 * RLS policy `allowlist_all_receipts` permits the delete for allowlisted users.
 */
export function useDeleteReceiptMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, DeleteReceiptVars>({
    mutationFn: async ({ id }) => {
      const { error } = await supabase.from('receipts').delete().eq('id', id);
      if (error) throw new Error(`Receipt delete failed: ${error.message}`);
    },
    onSuccess: async (_result, { id }) => {
      queryClient.removeQueries({ queryKey: receiptQueryKey(id) });
      await queryClient.invalidateQueries({ queryKey: receiptsQueryKey });
    },
  });
}

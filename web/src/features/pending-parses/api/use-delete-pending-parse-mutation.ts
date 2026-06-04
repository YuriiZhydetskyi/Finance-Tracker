import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { photoStorage } from '@/shared/lib/dependencies';
import { wrapError } from '@/shared/utils/wrap-error';
import { pendingParsesQueryKey } from './use-pending-parses';

export type DeletePendingParseVars = {
  id: string;
  /**
   * When set, also delete the Storage blob. OMIT after a successful re-parse +
   * save — the new receipt now owns the photo. PASS it for an explicit discard.
   */
  removePhotoPath?: string;
};

/**
 * Removes a queue row. The blob is deleted only on explicit discard; on a
 * successful save the photo is reused by the receipt, so we keep it.
 */
export function useDeletePendingParseMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, DeletePendingParseVars>({
    mutationFn: async ({ id, removePhotoPath }) => {
      const { error } = await supabase.from('pending_parses').delete().eq('id', id);
      if (error) throw wrapError('Pending parse delete failed', error);

      if (removePhotoPath) {
        await photoStorage.remove(removePhotoPath).catch(() => {
          /* swallow — row is gone; a stray blob is harmless (Phase 12 sweep) */
        });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pendingParsesQueryKey });
    },
  });
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ulid } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { photoStorage } from '@/shared/lib/dependencies';
import { wrapError } from '@/shared/utils/wrap-error';
import { pendingParsesQueryKey } from './use-pending-parses';

export type CreatePendingParseVars = {
  blob: Blob;
  paidBy: string;
  errorMessage: string;
  fileName: string;
  attempts: number;
};

export type CreatePendingParseResult = {
  id: string;
  photo_path: string;
};

/**
 * Persist a failed parse for later retry:
 *   1. Upload the photo to Storage (it was never uploaded — happy-path uploads
 *      only at save time).
 *   2. Insert the queue row referencing the Storage path + captured paid_by.
 *
 * Photo-first ordering mirrors useSavePhotoReceiptMutation: if the row insert
 * fails, best-effort delete the orphan blob before bubbling the error.
 */
export function useCreatePendingParseMutation() {
  const queryClient = useQueryClient();

  return useMutation<CreatePendingParseResult, Error, CreatePendingParseVars>({
    mutationFn: async ({ blob, paidBy, errorMessage, fileName, attempts }) => {
      const { path } = await photoStorage.upload(blob);
      const id = ulid();

      const { error } = await supabase.from('pending_parses').insert({
        id,
        photo_path: path,
        paid_by: paidBy,
        error_message: errorMessage,
        attempts,
        original_filename: fileName,
      });
      if (error) {
        await photoStorage.remove(path).catch(() => {
          /* swallow — surfacing the cleanup error would mask the real cause */
        });
        throw wrapError('Pending parse insert failed', error);
      }

      return { id, photo_path: path };
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pendingParsesQueryKey });
    },
  });
}

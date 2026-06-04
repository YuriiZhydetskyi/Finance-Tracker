import { useMutation } from '@tanstack/react-query';
import {
  useSaveReceiptMutation,
  type SaveItemInput,
  type SaveReceiptInput,
  type SaveReceiptResult,
} from '@/features/receipts';
import { useDeletePendingParseMutation } from '@/features/pending-parses';
import { photoStorage } from '@/shared/lib/dependencies';

export type SavePendingReceiptVars = {
  /** Receipt fields minus the photo URL — this hook re-signs `photoPath`. */
  receipt: Omit<SaveReceiptInput, 'photo_url'>;
  items: SaveItemInput[];
  /** Storage path of the already-uploaded photo from the queue row. */
  photoPath: string;
  /** Queue row id — deleted after the receipt is saved (photo is kept). */
  pendingId: string;
};

/**
 * Re-parse save: the photo already lives in Storage (it was uploaded when the
 * parse first failed), so we re-sign the existing path instead of uploading
 * again, save the receipt, then drop the queue row — keeping the blob, now
 * owned by the receipt.
 *
 * If the save fails, the queue row + photo are left intact so the user can try
 * again later; nothing is cleaned up.
 */
export function useSavePendingReceiptMutation() {
  const saveReceipt = useSaveReceiptMutation();
  const deletePending = useDeletePendingParseMutation();

  return useMutation<SaveReceiptResult, Error, SavePendingReceiptVars>({
    mutationFn: async ({ receipt, items, photoPath, pendingId }) => {
      const signedUrl = await photoStorage.getSignedUrl(photoPath);

      const result = await saveReceipt.mutateAsync({
        receipt: { ...receipt, photo_url: signedUrl },
        items,
      });

      // Receipt is safe — remove the queue row but keep the photo blob.
      await deletePending.mutateAsync({ id: pendingId });

      return result;
    },
  });
}

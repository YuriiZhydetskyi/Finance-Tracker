import { useMutation } from '@tanstack/react-query';
import {
  useSaveReceiptMutation,
  type SaveItemInput,
  type SaveReceiptInput,
  type SaveReceiptResult,
} from '@/features/receipts';
import { photoStorage } from '@/shared/lib/dependencies';

export type SavePhotoReceiptVars = {
  /**
   * Receipt fields *minus* the photo URL — this hook injects `photo_url` after
   * the photo is uploaded, so the receipt's `photo_url` is always a fresh
   * signed URL the row never has to lie about.
   */
  receipt: Omit<SaveReceiptInput, 'photo_url' | 'photo_path'>;
  items: SaveItemInput[];
  photoBlob: Blob;
};

/**
 * Photo-flow save:
 *   1. Upload the resized JPEG to Supabase Storage. Get path + signed URL.
 *   2. Delegate to useSaveReceiptMutation with `photo_url` set to the signed URL.
 *   3. If the receipt insert fails, best-effort delete the orphan photo so we
 *      don't accumulate detached blobs in the bucket.
 *
 * Photo-first ordering is intentional: a receipt row with a broken `photo_url`
 * would be visible to users; an orphan photo blob is invisible until cleanup.
 *
 * Limits of the cleanup: a network drop between upload-OK and remove-attempt
 * still leaves an orphan. A periodic Storage sweep job covers the remainder
 * (deferred to Phase 12).
 */
export function useSavePhotoReceiptMutation() {
  const saveReceipt = useSaveReceiptMutation();

  return useMutation<SaveReceiptResult, Error, SavePhotoReceiptVars>({
    mutationFn: async ({ receipt, items, photoBlob }) => {
      const { path, signedUrl } = await photoStorage.upload(photoBlob);

      try {
        return await saveReceipt.mutateAsync({
          receipt: { ...receipt, photo_url: signedUrl, photo_path: path },
          items,
        });
      } catch (e) {
        await photoStorage.remove(path).catch(() => {
          /* swallow — surfacing the cleanup error would mask the real cause */
        });
        throw e;
      }
    },
  });
}

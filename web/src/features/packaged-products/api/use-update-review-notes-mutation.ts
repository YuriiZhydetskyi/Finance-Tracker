import { useMutation, useQueryClient } from '@tanstack/react-query';
import { REVIEW_NOTES_SCHEMA, normalizeReviewNotes } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import { packagedProductQueryKey, packagedProductsQueryKey } from './packaged-products-query-keys';

/**
 * Replaces the whole "needs manual check" list of one card. Marking a note as
 * checked is just writing the list without it; writing `[]` clears the marker.
 */
export function useUpdateReviewNotesMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { id: string; review_notes: string[] }>({
    mutationFn: async ({ id, review_notes }) => {
      const parsed = REVIEW_NOTES_SCHEMA.safeParse(normalizeReviewNotes(review_notes));
      if (!parsed.success) {
        throw new Error('Примітка може мати до 300 символів, а на картці їх не більше 50.');
      }
      const { error } = await supabase
        .from('packaged_products')
        .update({ review_notes: parsed.data })
        .eq('id', id);
      if (error) throw wrapError('Не вдалося оновити примітки до перевірки', error);
    },
    onSuccess: (_void, { id }) => {
      void queryClient.invalidateQueries({ queryKey: packagedProductsQueryKey });
      // Returned, so the mutation stays pending until the card is re-read: the next
      // click is then never computed from a stale list that still has a removed note.
      return queryClient.invalidateQueries({ queryKey: packagedProductQueryKey(id) });
    },
  });
}

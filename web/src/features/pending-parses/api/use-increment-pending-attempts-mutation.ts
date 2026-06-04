import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import { pendingParsesQueryKey } from './use-pending-parses';

export type IncrementPendingAttemptsVars = {
  id: string;
  /** New cumulative total (caller sums the row's prior attempts + this session). */
  attempts: number;
  errorMessage: string;
};

/**
 * Bumps `attempts` and refreshes `error_message` after a re-parse from the
 * queue fails again — the row stays so the user can try once more later.
 * `updated_at` is set by the table's set_updated_at() trigger, not here.
 */
export function useIncrementPendingAttemptsMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, IncrementPendingAttemptsVars>({
    mutationFn: async ({ id, attempts, errorMessage }) => {
      const { error } = await supabase
        .from('pending_parses')
        .update({ attempts, error_message: errorMessage })
        .eq('id', id);
      if (error) throw wrapError('Pending parse update failed', error);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pendingParsesQueryKey });
    },
  });
}

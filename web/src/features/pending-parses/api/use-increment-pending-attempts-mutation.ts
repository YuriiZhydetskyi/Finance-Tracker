import { useMutation, useQueryClient } from '@tanstack/react-query';
import { nowIso } from '@finance-tracker/domain';
import { supabase } from '@/shared/lib/supabase-client';
import { wrapError } from '@/shared/utils/wrap-error';
import { pendingParsesQueryKey } from './use-pending-parses';

export type IncrementPendingAttemptsVars = {
  id: string;
  /** New total (caller passes current attempts + 1). */
  attempts: number;
  errorMessage: string;
};

/**
 * Bumps `attempts` and refreshes `error_message` after a re-parse from the
 * queue fails again — the row stays so the user can try once more later.
 */
export function useIncrementPendingAttemptsMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, IncrementPendingAttemptsVars>({
    mutationFn: async ({ id, attempts, errorMessage }) => {
      const { error } = await supabase
        .from('pending_parses')
        .update({ attempts, error_message: errorMessage, updated_at: nowIso() })
        .eq('id', id);
      if (error) throw wrapError('Pending parse update failed', error);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: pendingParsesQueryKey });
    },
  });
}

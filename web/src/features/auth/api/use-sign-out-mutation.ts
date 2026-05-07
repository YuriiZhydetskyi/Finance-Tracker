import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authService } from '@/shared/lib/dependencies';
import { currentUserQueryKey } from './use-current-user';

export function useSignOutMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, void>({
    mutationFn: () => authService.signOut(),
    onSuccess: async () => {
      queryClient.setQueryData(currentUserQueryKey, null);
      await queryClient.invalidateQueries();
    },
  });
}

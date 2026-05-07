import { useMutation } from '@tanstack/react-query';
import { authService } from '@/shared/lib/dependencies';

type SignInVars = { email: string };

/**
 * Sends a magic-link email. The link redirects the user back to /auth/callback
 * on the same origin where the Supabase client picks up the session from
 * the URL fragment.
 */
export function useSignInMutation() {
  return useMutation<void, Error, SignInVars>({
    mutationFn: async ({ email }) => {
      const redirectTo = `${window.location.origin}/auth/callback`;
      await authService.signInWithMagicLink(email, redirectTo);
    },
  });
}

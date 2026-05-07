import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useCurrentUser } from '@/features/auth';

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallbackPage,
});

/**
 * Magic-link landing. Supabase JS client auto-detects the session from the
 * URL hash on app load (because we set `detectSessionInUrl: true` on the
 * client). Once `useCurrentUser` reflects the new session, we navigate home.
 */
function AuthCallbackPage() {
  const { data: user, isLoading } = useCurrentUser();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      void navigate({ to: '/', replace: true });
    }
  }, [user, navigate]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-600">
      {isLoading ? 'Завершуємо вхід...' : 'Перенаправляємо...'}
    </div>
  );
}

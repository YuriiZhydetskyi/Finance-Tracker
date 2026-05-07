import type { ReactNode } from 'react';
import { useCurrentUser } from '../api/use-current-user';
import { useAllowlistCheck } from '../api/use-allowlist-check';
import { SignInForm } from '../components/SignInForm';

type Props = { children: ReactNode };

/**
 * Three states:
 *   - loading      → spinner
 *   - unauth       → SignInForm
 *   - auth + !allowlisted → "not authorized" message
 *   - auth + allowlisted  → render children
 */
export function RequireAuth({ children }: Props) {
  const userQuery = useCurrentUser();
  const allowlistQuery = useAllowlistCheck();

  if (userQuery.isLoading) {
    return <CenteredMessage>Завантаження...</CenteredMessage>;
  }

  if (!userQuery.data) {
    return (
      <div className="mx-auto mt-12 max-w-md px-4">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-slate-900">Вхід</h1>
        <p className="mb-6 text-sm text-slate-600">
          Введи свій email — ми надішлемо одноразове посилання для входу.
        </p>
        <SignInForm />
      </div>
    );
  }

  if (allowlistQuery.isLoading) {
    return <CenteredMessage>Перевіряємо доступ...</CenteredMessage>;
  }

  if (allowlistQuery.data === false) {
    return (
      <CenteredMessage>
        <div className="text-center">
          <h1 className="mb-2 text-xl font-semibold text-slate-900">Доступ заборонено</h1>
          <p className="text-sm text-slate-600">
            Email <strong>{userQuery.data.email}</strong> не у списку дозволених.
          </p>
        </div>
      </CenteredMessage>
    );
  }

  return children;
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-600">
      {children}
    </div>
  );
}

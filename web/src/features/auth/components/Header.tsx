import { Link } from '@tanstack/react-router';
import { Button } from '@/shared/ui/Button';
import { useCurrentUser } from '../api/use-current-user';
import { useSignOutMutation } from '../api/use-sign-out-mutation';

export function Header() {
  const { data: user } = useCurrentUser();
  const signOut = useSignOutMutation();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
        <Link to="/" className="text-base font-semibold tracking-tight text-slate-900">
          Finance Tracker
        </Link>
        {user && (
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">{user.email}</span>
            <Button variant="ghost" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
              Вийти
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}

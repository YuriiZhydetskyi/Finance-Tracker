import { createFileRoute, Outlet } from '@tanstack/react-router';
import { RequireAuth } from '@/features/auth';

export const Route = createFileRoute('/_authed')({
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <RequireAuth>
      <Outlet />
    </RequireAuth>
  );
}

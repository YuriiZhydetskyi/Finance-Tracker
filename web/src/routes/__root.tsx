import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Header } from '@/features/auth';
import { DefaultErrorComponent } from '@/shared/ui/DefaultErrorComponent';

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: DefaultErrorComponent,
});

function RootLayout() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

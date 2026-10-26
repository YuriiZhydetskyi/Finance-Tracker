import { lazy, Suspense } from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Header } from '@/features/auth';
import { DefaultErrorComponent } from '@/shared/ui/DefaultErrorComponent';

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: DefaultErrorComponent,
});

// `import.meta.env.DEV` is a build-time constant, so production builds drop the dynamic
// imports (and the devtools packages) entirely. Vitest runs with DEV on; keep them out of tests.
const showDevtools = import.meta.env.DEV && import.meta.env.MODE !== 'test';

const ReactQueryDevtools = showDevtools
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({ default: m.ReactQueryDevtools })),
    )
  : null;

const TanStackRouterDevtools = showDevtools
  ? lazy(() =>
      import('@tanstack/react-router-devtools').then((m) => ({
        default: m.TanStackRouterDevtools,
      })),
    )
  : null;

function RootLayout() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
      {ReactQueryDevtools && TanStackRouterDevtools && (
        <Suspense fallback={null}>
          <ReactQueryDevtools />
          <TanStackRouterDevtools />
        </Suspense>
      )}
    </div>
  );
}

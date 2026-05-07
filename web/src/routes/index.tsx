import { createFileRoute } from '@tanstack/react-router';
import { RequireAuth } from '@/features/auth';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <RequireAuth>
      <Welcome />
    </RequireAuth>
  );
}

function Welcome() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
      <h1 className="mb-2 text-2xl font-bold tracking-tight">Готово до роботи</h1>
      <p className="mb-6 text-sm text-slate-600">
        Auth shell працює. Сторінки <code className="rounded bg-slate-100 px-1">/photo</code>,{' '}
        <code className="rounded bg-slate-100 px-1">/manual</code>,{' '}
        <code className="rounded bg-slate-100 px-1">/recent</code>,{' '}
        <code className="rounded bg-slate-100 px-1">/stats</code> з&apos;являться у наступних фазах.
      </p>
    </div>
  );
}

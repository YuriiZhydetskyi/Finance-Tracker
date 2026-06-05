import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';
import { RequireAuth } from '@/features/auth';
import { usePendingParses } from '@/features/pending-parses';
import { Button } from '@/shared/ui/Button';

const HomeSearchSchema = z
  .object({
    saved: z.string().optional(),
  })
  .optional();

export const Route = createFileRoute('/')({
  component: HomePage,
  validateSearch: HomeSearchSchema,
});

function HomePage() {
  const search = Route.useSearch();
  const savedId = search?.saved;

  return (
    <RequireAuth>
      <HomeNav savedId={savedId} />
    </RequireAuth>
  );
}

function HomeNav({ savedId }: { savedId?: string | undefined }) {
  const pendingQuery = usePendingParses();
  const pendingCount = pendingQuery.data?.length ?? 0;

  return (
    <div className="space-y-4">
      {savedId && (
        <div
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          Чек збережено. ID: <code className="rounded bg-emerald-100 px-1">{savedId}</code>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">Finance Tracker</h1>
        <p className="mb-6 text-sm text-slate-600">
          Сфотографуй чек, введи вручну, переглянь останні або статистику.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link to="/photo">
            <Button>Фото чек</Button>
          </Link>
          <Link to="/manual">
            <Button variant="secondary">Додати вручну</Button>
          </Link>
          <Link to="/recent">
            <Button variant="secondary">Останні чеки</Button>
          </Link>
          <Link to="/waste">
            <Button variant="secondary">Викинули</Button>
          </Link>
          <Link to="/stats">
            <Button variant="secondary">Статистика</Button>
          </Link>
          <Link to="/reconcile">
            <Button variant="secondary">Звірка виписки</Button>
          </Link>
          {pendingCount > 0 && (
            <Link to="/pending">
              <Button variant="secondary">
                Чеки з помилками
                <span className="rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
                  {pendingCount}
                </span>
              </Button>
            </Link>
          )}
        </div>
        <p className="mt-6 text-xs text-slate-400">v{__APP_VERSION__}</p>
      </div>
    </div>
  );
}

import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';
import { RequireAuth } from '@/features/auth';
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
            <Link to="/stats">
              <Button variant="secondary">Статистика</Button>
            </Link>
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}

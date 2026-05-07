import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { RequireAuth } from '@/features/auth';
import { useReceipts, ReceiptCard, EmptyReceiptsState } from '@/features/receipts';

const RecentSearchSchema = z
  .object({
    saved: z.string().optional(),
  })
  .optional();

export const Route = createFileRoute('/recent')({
  component: RecentPage,
  validateSearch: RecentSearchSchema,
});

function RecentPage() {
  return (
    <RequireAuth>
      <RecentList />
    </RequireAuth>
  );
}

function RecentList() {
  const search = Route.useSearch();
  const savedId = search?.saved;
  const query = useReceipts();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Останні чеки</h1>
        <p className="text-sm text-slate-600">До 30 останніх. Натисни на чек, щоб редагувати.</p>
      </div>

      {savedId && (
        <div
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          Чек збережено. ID: <code className="rounded bg-emerald-100 px-1">{savedId}</code>
        </div>
      )}

      {query.isLoading && <p className="text-sm text-slate-500">Завантажую...</p>}
      {query.isError && (
        <p role="alert" className="text-sm text-red-600">
          Не вдалося завантажити: {query.error.message}
        </p>
      )}
      {query.isSuccess && query.data.length === 0 && <EmptyReceiptsState />}
      {query.isSuccess && query.data.length > 0 && (
        <ul className="space-y-2">
          {query.data.map((r) => (
            <li key={r.id}>
              <ReceiptCard receipt={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

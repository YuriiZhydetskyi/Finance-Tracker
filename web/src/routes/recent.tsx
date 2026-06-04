import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { useAppUsers, RequireAuth } from '@/features/auth';
import {
  countActiveFilters,
  EmptyReceiptsState,
  NoMatchingReceipts,
  ReceiptCard,
  RecentFiltersBar,
  RecentSearchSchema,
  searchToFilters,
  useReceipts,
} from '@/features/receipts';

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
  const search = Route.useSearch() ?? {};
  const navigate = useNavigate();
  const appUsersQuery = useAppUsers();
  const filters = searchToFilters(search);
  const activeCount = countActiveFilters(filters);
  const query = useReceipts(filters);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Останні чеки</h1>
        <p className="text-sm text-slate-600">
          До 30 чеків за поточними фільтрами. Натисни на чек, щоб редагувати.
        </p>
      </div>

      {search.saved && (
        <div
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
        >
          Чек збережено. ID: <code className="rounded bg-emerald-100 px-1">{search.saved}</code>
        </div>
      )}

      <RecentFiltersBar
        search={search}
        paidByOptions={appUsersQuery.data ?? []}
        activeCount={activeCount}
      />

      {query.isLoading && <p className="text-sm text-slate-500">Завантажую...</p>}
      {query.isError && <ErrorDetails error={query.error} label="Не вдалося завантажити" />}
      {query.isSuccess &&
        query.data.length === 0 &&
        (activeCount > 0 ? (
          <NoMatchingReceipts onClearFilters={() => void navigate({ to: '/recent', search: {} })} />
        ) : (
          <EmptyReceiptsState />
        ))}
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

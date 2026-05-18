import { useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { RequireAuth } from '@/features/auth';
import { useCategories } from '@/features/categories';
import { formatMoney } from '@/shared/utils/format-money';
import {
  WasteFiltersBar,
  WasteItemCard,
  WasteSearchSchema,
  countActiveWasteFilters,
  searchToWasteFilters,
  useWasteItems,
  type WasteItemRow,
} from '@/features/waste';

export const Route = createFileRoute('/waste')({
  component: WastePage,
  validateSearch: WasteSearchSchema,
});

function WastePage() {
  return (
    <RequireAuth>
      <WasteList />
    </RequireAuth>
  );
}

// Sum wasted-EUR across the items currently in view. Grouping by currency
// would be more rigorous, but EUR is the canonical audit currency on
// every row (total_eur), so a single sum is the user-facing number we want.
function sumWastedEur(rows: WasteItemRow[]): number {
  let sum = 0;
  for (const r of rows) {
    if (r.qty > 0 && r.wasted_qty > 0) {
      sum += (r.wasted_qty / r.qty) * r.total_eur;
    }
  }
  return sum;
}

function WasteList() {
  const search = Route.useSearch() ?? {};
  const filters = searchToWasteFilters(search);
  const activeCount = countActiveWasteFilters(search);
  const itemsQuery = useWasteItems(filters);
  const categoriesQuery = useCategories();
  const categoryNames = useMemo(
    () => categoriesQuery.data?.map((c) => c.name) ?? [],
    [categoriesQuery.data],
  );

  const wastedTotalEur = useMemo(() => sumWastedEur(itemsQuery.data ?? []), [itemsQuery.data]);

  return (
    <div className="space-y-4 pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Викинули</h1>
        <p className="text-sm text-slate-600">
          Познач, скільки кожного товару не доїли — побачиш, у скільки це обійшлось. Дефолтно
          показуємо покупки за останні 60 днів. Чек з{' '}
          <code className="rounded bg-slate-100 px-1">{filters.dateFrom}</code> і пізніше.
        </p>
      </div>

      <WasteFiltersBar search={search} categoryOptions={categoryNames} activeCount={activeCount} />

      {itemsQuery.isLoading && <p className="text-sm text-slate-500">Завантажую…</p>}
      {itemsQuery.isError && (
        <p role="alert" className="text-sm text-red-600">
          Не вдалося завантажити: {itemsQuery.error.message}
        </p>
      )}
      {itemsQuery.isSuccess && itemsQuery.data.length === 0 && (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
          Жодного товару за цими фільтрами. Спробуй розширити дату або очистити фільтри.
        </div>
      )}
      {itemsQuery.isSuccess && itemsQuery.data.length > 0 && (
        <ul className="space-y-2">
          {itemsQuery.data.map((it) => (
            <li key={it.id}>
              <WasteItemCard item={it} />
            </li>
          ))}
        </ul>
      )}

      {wastedTotalEur > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-red-200 bg-red-50/95 px-4 py-2 backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between text-sm">
            <span className="text-red-700">Усього викинуто (за фільтром):</span>
            <span className="font-semibold tabular-nums text-red-800">
              {formatMoney(wastedTotalEur, 'EUR')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

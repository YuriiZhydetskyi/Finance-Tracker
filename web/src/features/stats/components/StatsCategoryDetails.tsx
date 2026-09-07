import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import { formatMoney } from '@/shared/utils/format-money';
import { useCategoryDetails } from '../api/use-category-details';
import type { StatsDateRange, StatsFilters } from '../api/stats.types';
import type { StatsSelection } from '../category-details';
import { formatPeriodRange } from '../stats-period';
import { ByMonthChart } from './ByMonthChart';
import { StatsBreakdown } from './StatsBreakdown';

type Props = {
  selection: StatsSelection;
  categories: { name: string; group_name: string }[];
  categoriesReady: boolean;
  range: StatsDateRange | null;
  filters: StatsFilters;
  onSelect: (selection: StatsSelection) => void;
};

export function StatsCategoryDetails({
  selection,
  categories,
  categoriesReady,
  range,
  filters,
  onSelect,
}: Props) {
  const selectedCategories =
    selection.category !== undefined
      ? [selection.category]
      : categories
          .filter((category) => category.group_name === selection.group)
          .map((category) => category.name);
  const scope = selectedCategories.filter(
    (category) => !filters.categories || filters.categories.includes(category),
  );
  const query = useCategoryDetails(
    range ?? {},
    { ...filters, categories: scope },
    range !== null && (selection.category !== undefined || categoriesReady),
  );
  const title = selection.category ?? selection.group ?? '';
  const group = selection.group;
  const data = query.data;

  return (
    <div className="space-y-4">
      <nav aria-label="Шлях статистики" className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="text-teal-700 underline" onClick={() => onSelect({})}>
          Уся статистика
        </button>
        {selection.group !== undefined && selection.category !== undefined ? (
          <>
            <span aria-hidden="true">/</span>
            <button
              type="button"
              className="text-teal-700 underline"
              onClick={() => onSelect(group !== undefined ? { group } : {})}
            >
              {selection.group}
            </button>
          </>
        ) : null}
        <span aria-hidden="true">/</span>
        <span aria-current="page">{title}</span>
      </nav>
      <header>
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">
          {range ? formatPeriodRange(range) : 'Вкажіть початок і кінець свого періоду.'}
        </p>
      </header>
      {range === null ? null : query.isError ? (
        <ErrorDetails error={query.error} label="Не вдалося завантажити деталізацію" />
      ) : !data ? (
        <p role="status" className="text-sm text-slate-500">
          Завантажую...
        </p>
      ) : data.items_count === 0 ? (
        <p className="text-sm text-slate-500">За вибраними фільтрами покупок немає.</p>
      ) : (
        <>
          <section className="rounded-md border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-600">
              Витрачено · {data.receipts_count} чеків · {data.items_count} позицій
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">
              {formatMoney(data.total_eur, 'EUR')}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Частки від суми «{title}» за вибраними фільтрами. Повернення та від’ємні позиції
              враховано.
              {data.total_eur <= 0
                ? ' За нульового або від’ємного підсумку частки не розраховуються.'
                : ''}
            </p>
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-md border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold">По місяцях</h3>
              <div className="h-72">
                <ByMonthChart rows={data.months} />
              </div>
            </section>
            <section className="rounded-md border border-slate-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold">По магазинах</h3>
              <StatsBreakdown rows={data.stores} total={data.total_eur} label="Магазин" />
            </section>
            {selection.category === undefined ? (
              <section className="rounded-md border border-slate-200 bg-white p-4">
                <h3 className="mb-2 text-sm font-semibold">По категоріях</h3>
                <StatsBreakdown
                  rows={data.categories}
                  total={data.total_eur}
                  label="Категорія"
                  onSelect={(category) => onSelect({ ...selection, category })}
                />
              </section>
            ) : null}
            <section className="rounded-md border border-slate-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold">По сімействах товарів</h3>
              <p className="mb-2 text-xs text-slate-500">
                Однакові сімейства об’єднано незалежно від магазину, бренду та упаковки.
              </p>
              <StatsBreakdown rows={data.families} total={data.total_eur} label="Сімейство" />
            </section>
          </div>
        </>
      )}
    </div>
  );
}

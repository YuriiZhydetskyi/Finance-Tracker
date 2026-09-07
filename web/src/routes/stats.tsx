import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { useState, type ReactNode } from 'react';
import { RequireAuth } from '@/features/auth';
import { ErrorDetails } from '@/shared/ui/ErrorDetails';
import {
  ByCategoryChart,
  ByMonthChart,
  ByStoreChart,
  ByUserChart,
  SavingsByMonthChart,
  StatsFiltersPicker,
  StatsPeriodPicker,
  WasteByMonthChart,
  formatPeriodRange,
  loadStatsDateRange,
  loadStatsFilters,
  useStatsByCategory,
  useStatsFilterOptions,
  useStatsByMonth,
  useStatsByStore,
  useStatsByUser,
  useStatsSavingsByMonth,
  useStatsWasteByMonth,
  type StatsDateRange,
  type StatsFilters,
} from '@/features/stats';
import { formatMoney } from '@/shared/utils/format-money';

const StatsSearchSchema = z.object({}).optional();
const EMPTY_FILTER_OPTIONS = { categories: [], stores: [] };

export const Route = createFileRoute('/stats')({
  component: StatsPage,
  validateSearch: StatsSearchSchema,
});

function StatsPage() {
  return (
    <RequireAuth>
      <StatsDashboard />
    </RequireAuth>
  );
}

type SectionProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  height?: string;
};

function Section({ title, subtitle, children, height = 'h-72' }: SectionProps) {
  return (
    <section className="rounded-md border border-slate-200 bg-white p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
      </header>
      <div className={`relative ${height}`}>{children}</div>
    </section>
  );
}

function ChartState({
  isLoading,
  isError,
  error,
  isEmpty,
  isPeriodIncomplete,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  isEmpty: boolean;
  isPeriodIncomplete?: boolean;
  children: ReactNode;
}) {
  if (isPeriodIncomplete) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-slate-500">
        Вкажіть початок і кінець свого періоду.
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Завантажую...
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-2">
        <ErrorDetails error={error} label="Не вдалося завантажити" className="max-w-full" />
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Поки що порожньо.
      </div>
    );
  }
  return <>{children}</>;
}

function StatsDashboard() {
  const [dateRange, setDateRange] = useState<StatsDateRange | null>(loadStatsDateRange);
  const [filters, setFilters] = useState<StatsFilters>(loadStatsFilters);
  const periodReady = dateRange !== null;
  const queryRange = dateRange ?? {};
  const queryOptions = { enabled: periodReady };
  const filterOptionsQuery = useStatsFilterOptions();
  const monthQuery = useStatsByMonth(queryRange, filters, queryOptions);
  const categoryQuery = useStatsByCategory(queryRange, filters, queryOptions);
  const userQuery = useStatsByUser(queryRange, filters, queryOptions);
  const storeQuery = useStatsByStore(queryRange, filters, 10, queryOptions);
  const savingsQuery = useStatsSavingsByMonth(queryRange, filters, queryOptions);
  const wasteQuery = useStatsWasteByMonth(queryRange, filters, queryOptions);
  const periodLabel = dateRange ? formatPeriodRange(dateRange) : 'Оберіть початок і кінець';

  const savingsRows = savingsQuery.data ?? [];
  const totalSaved = savingsRows.reduce((acc, r) => acc + r.savings_eur, 0);
  const totalDiscountedItems = savingsRows.reduce((acc, r) => acc + r.discounted_items_count, 0);

  const wasteRows = wasteQuery.data ?? [];
  const totalWasted = wasteRows.reduce((acc, r) => acc + r.wasted_value_eur, 0);
  const totalWastedItems = wasteRows.reduce((acc, r) => acc + r.wasted_items_count, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Статистика</h1>
        <p className="text-sm text-slate-600">Усі суми у EUR.</p>
      </div>

      <StatsPeriodPicker onChange={setDateRange} />
      {filterOptionsQuery.isError ? (
        <ErrorDetails error={filterOptionsQuery.error} label="Не вдалося завантажити фільтри" />
      ) : null}
      <StatsFiltersPicker
        options={filterOptionsQuery.data ?? EMPTY_FILTER_OPTIONS}
        isLoading={filterOptionsQuery.isLoading}
        onChange={setFilters}
      />

      <section className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-emerald-900">Заощаджено на знижках</h2>
            <p className="text-xs text-emerald-700">
              {!periodReady
                ? 'Вкажіть початок і кінець свого періоду'
                : savingsQuery.isLoading
                  ? 'Завантажую...'
                  : `Сума знижок по всіх позиціях · ${String(totalDiscountedItems)} позицій зі знижкою`}
            </p>
          </div>
          <span className="text-3xl font-semibold tabular-nums text-emerald-900">
            {!periodReady || savingsQuery.isLoading ? '—' : formatMoney(totalSaved, 'EUR')}
          </span>
        </div>
      </section>

      <section className="rounded-md border border-red-200 bg-red-50 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-red-900">Викинули</h2>
            <p className="text-xs text-red-700">
              {!periodReady
                ? 'Вкажіть початок і кінець свого періоду'
                : wasteQuery.isLoading
                  ? 'Завантажую...'
                  : `Сума зіпсованого · ${String(totalWastedItems)} позицій`}
            </p>
          </div>
          <span className="text-3xl font-semibold tabular-nums text-red-900">
            {!periodReady || wasteQuery.isLoading ? '—' : formatMoney(totalWasted, 'EUR')}
          </span>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="По місяцях" subtitle={periodLabel}>
          <ChartState
            isLoading={monthQuery.isLoading}
            isError={monthQuery.isError}
            error={monthQuery.error}
            isEmpty={monthQuery.isSuccess && monthQuery.data.length === 0}
            isPeriodIncomplete={!periodReady}
          >
            <ByMonthChart rows={monthQuery.data ?? []} />
          </ChartState>
        </Section>

        <Section title="Заощаджено по місяцях" subtitle={`Сума знижок у EUR · ${periodLabel}`}>
          <ChartState
            isLoading={savingsQuery.isLoading}
            isError={savingsQuery.isError}
            error={savingsQuery.error}
            isEmpty={savingsQuery.isSuccess && savingsRows.length === 0}
            isPeriodIncomplete={!periodReady}
          >
            <SavingsByMonthChart rows={savingsRows} />
          </ChartState>
        </Section>

        <Section title="Викинули по місяцях" subtitle={`Сума зіпсованого у EUR · ${periodLabel}`}>
          <ChartState
            isLoading={wasteQuery.isLoading}
            isError={wasteQuery.isError}
            error={wasteQuery.error}
            isEmpty={wasteQuery.isSuccess && wasteRows.length === 0}
            isPeriodIncomplete={!periodReady}
          >
            <WasteByMonthChart rows={wasteRows} />
          </ChartState>
        </Section>

        <Section title="По користувачах" subtitle={`Хто скільки сплатив · ${periodLabel}`}>
          <ChartState
            isLoading={userQuery.isLoading}
            isError={userQuery.isError}
            error={userQuery.error}
            isEmpty={userQuery.isSuccess && userQuery.data.length === 0}
            isPeriodIncomplete={!periodReady}
          >
            <ByUserChart rows={userQuery.data ?? []} />
          </ChartState>
        </Section>

        <Section
          title="По категоріях"
          subtitle={`Сума за товарними позиціями · ${periodLabel}`}
          height="h-96"
        >
          <ChartState
            isLoading={categoryQuery.isLoading}
            isError={categoryQuery.isError}
            error={categoryQuery.error}
            isEmpty={categoryQuery.isSuccess && categoryQuery.data.length === 0}
            isPeriodIncomplete={!periodReady}
          >
            <ByCategoryChart rows={categoryQuery.data ?? []} />
          </ChartState>
        </Section>

        <Section
          title="По магазинах"
          subtitle={`Топ-10 за загальною сумою · ${periodLabel}`}
          height="h-96"
        >
          <ChartState
            isLoading={storeQuery.isLoading}
            isError={storeQuery.isError}
            error={storeQuery.error}
            isEmpty={storeQuery.isSuccess && storeQuery.data.length === 0}
            isPeriodIncomplete={!periodReady}
          >
            <ByStoreChart rows={storeQuery.data ?? []} />
          </ChartState>
        </Section>
      </div>
    </div>
  );
}

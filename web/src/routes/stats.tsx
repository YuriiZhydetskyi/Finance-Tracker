import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import type { ReactNode } from 'react';
import { RequireAuth } from '@/features/auth';
import {
  ByCategoryChart,
  ByMonthChart,
  ByStoreChart,
  ByUserChart,
  useStatsByCategory,
  useStatsByMonth,
  useStatsByStore,
  useStatsByUser,
} from '@/features/stats';

const StatsSearchSchema = z.object({}).optional();

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
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  isEmpty: boolean;
  children: ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-500">
        Завантажую...
      </div>
    );
  }
  if (isError) {
    return (
      <div role="alert" className="flex h-full items-center justify-center text-sm text-red-600">
        Не вдалося завантажити: {error?.message ?? 'unknown error'}
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
  const monthQuery = useStatsByMonth(12);
  const categoryQuery = useStatsByCategory();
  const userQuery = useStatsByUser();
  const storeQuery = useStatsByStore(10);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Статистика</h1>
        <p className="text-sm text-slate-600">Усі суми у EUR. Дані оновлюються при перезаході.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="По місяцях" subtitle="Останні 12 місяців">
          <ChartState
            isLoading={monthQuery.isLoading}
            isError={monthQuery.isError}
            error={monthQuery.error}
            isEmpty={monthQuery.isSuccess && monthQuery.data.length === 0}
          >
            <ByMonthChart rows={monthQuery.data ?? []} />
          </ChartState>
        </Section>

        <Section title="По користувачах" subtitle="Хто скільки сплатив (paid_by)">
          <ChartState
            isLoading={userQuery.isLoading}
            isError={userQuery.isError}
            error={userQuery.error}
            isEmpty={userQuery.isSuccess && userQuery.data.length === 0}
          >
            <ByUserChart rows={userQuery.data ?? []} />
          </ChartState>
        </Section>

        <Section title="По категоріях" subtitle="Сума за товарними позиціями" height="h-96">
          <ChartState
            isLoading={categoryQuery.isLoading}
            isError={categoryQuery.isError}
            error={categoryQuery.error}
            isEmpty={categoryQuery.isSuccess && categoryQuery.data.length === 0}
          >
            <ByCategoryChart rows={categoryQuery.data ?? []} />
          </ChartState>
        </Section>

        <Section title="По магазинах" subtitle="Топ-10 за загальною сумою" height="h-96">
          <ChartState
            isLoading={storeQuery.isLoading}
            isError={storeQuery.isError}
            error={storeQuery.error}
            isEmpty={storeQuery.isSuccess && storeQuery.data.length === 0}
          >
            <ByStoreChart rows={storeQuery.data ?? []} />
          </ChartState>
        </Section>
      </div>
    </div>
  );
}

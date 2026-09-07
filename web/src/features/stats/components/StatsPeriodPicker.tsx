import { useEffect, useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { cn } from '@/shared/ui/cn';
import {
  formatPeriodRange,
  isValidCustomRange,
  periodToDateRange,
  type StatsPeriod,
} from '../stats-period';
import type { StatsDateRange } from '../api/stats.types';
import { loadStatsPreferences, saveStatsPreferences } from '../stats-preferences';

const OPTIONS: { value: StatsPeriod; label: string }[] = [
  { value: 'all-time', label: 'За весь час' },
  { value: 'last-3-months', label: 'Останні 3 місяці' },
  { value: 'last-month', label: 'Останній місяць' },
  { value: 'last-week', label: 'Останній тиждень' },
  { value: 'custom', label: 'Свій період' },
];

type Props = {
  onChange: (range: StatsDateRange | null) => void;
};

export function StatsPeriodPicker({ onChange }: Props) {
  const [period, setPeriod] = useState<StatsPeriod>(
    () => loadStatsPreferences().period ?? 'last-3-months',
  );
  const [customRange, setCustomRange] = useState<Required<StatsDateRange>>(
    () => loadStatsPreferences().customRange ?? { dateFrom: '', dateTo: '' },
  );

  useEffect(() => {
    onChange(
      period === 'custom'
        ? customRange.dateFrom && customRange.dateTo && isValidCustomRange(customRange)
          ? customRange
          : null
        : periodToDateRange(period),
    );
    // The route's state setter is stable. This effect only restores the saved
    // choice after the picker mounts, not after every interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectPeriod = (nextPeriod: StatsPeriod) => {
    setPeriod(nextPeriod);
    saveStatsPreferences({ period: nextPeriod });
    if (nextPeriod === 'custom') {
      onChange(
        customRange.dateFrom && customRange.dateTo && isValidCustomRange(customRange)
          ? customRange
          : null,
      );
      return;
    }
    onChange(periodToDateRange(nextPeriod));
  };

  const updateCustomRange = (patch: Partial<Required<StatsDateRange>>) => {
    const nextRange = { ...customRange, ...patch };
    setCustomRange(nextRange);
    saveStatsPreferences({ customRange: nextRange });
    onChange(
      nextRange.dateFrom && nextRange.dateTo && isValidCustomRange(nextRange) ? nextRange : null,
    );
  };

  const customError =
    period === 'custom' && customRange.dateFrom && customRange.dateTo
      ? !isValidCustomRange(customRange)
      : false;

  return (
    <section
      className="rounded-md border border-slate-200 bg-white p-4"
      aria-label="Період статистики"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Період</h2>
          <p className="text-xs text-slate-500">Статистика рахується за датою чека.</p>
        </div>
        <span className="text-sm font-medium tabular-nums text-slate-700">
          {period === 'custom' && !customRange.dateFrom && !customRange.dateTo
            ? 'Оберіть початок і кінець'
            : formatPeriodRange(period === 'custom' ? customRange : periodToDateRange(period))}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Швидкий вибір періоду">
        {OPTIONS.map((option) => (
          <Button
            key={option.value}
            variant={period === option.value ? 'primary' : 'secondary'}
            className="h-9 px-3"
            aria-pressed={period === option.value}
            onClick={() => selectPeriod(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {period === 'custom' ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600" htmlFor="stats-date-from">
            З дати
            <Input
              id="stats-date-from"
              className={cn(
                'mt-1',
                customError && 'border-red-500 focus:border-red-600 focus:ring-red-600',
              )}
              type="date"
              value={customRange.dateFrom}
              max={customRange.dateTo || undefined}
              onChange={(event) => updateCustomRange({ dateFrom: event.target.value })}
            />
          </label>
          <label className="text-xs font-medium text-slate-600" htmlFor="stats-date-to">
            По дату
            <Input
              id="stats-date-to"
              className={cn(
                'mt-1',
                customError && 'border-red-500 focus:border-red-600 focus:ring-red-600',
              )}
              type="date"
              value={customRange.dateTo}
              min={customRange.dateFrom || undefined}
              onChange={(event) => updateCustomRange({ dateTo: event.target.value })}
            />
          </label>
          {customError ? (
            <p className="text-sm text-red-700 sm:col-span-2" role="alert">
              Початкова дата має бути не пізніше кінцевої.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

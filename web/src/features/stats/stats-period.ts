import type { StatsDateRange } from './api/stats.types';

export const STATS_PERIODS = [
  'all-time',
  'last-3-months',
  'last-month',
  'last-week',
  'custom',
] as const;

export type StatsPeriod = (typeof STATS_PERIODS)[number];

function toIsoDate(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function subtractCalendarMonths(today: Date, months: number): Date {
  const day = today.getDate();
  const target = new Date(today.getFullYear(), today.getMonth() - months, 1);
  const daysInTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, daysInTargetMonth));
  return target;
}

export function periodToDateRange(
  period: Exclude<StatsPeriod, 'custom'>,
  today = new Date(),
): StatsDateRange {
  const dateTo = toIsoDate(today);
  switch (period) {
    case 'all-time':
      return {};
    case 'last-3-months':
      return { dateFrom: toIsoDate(subtractCalendarMonths(today, 3)), dateTo };
    case 'last-month':
      return { dateFrom: toIsoDate(subtractCalendarMonths(today, 1)), dateTo };
    case 'last-week':
      return {
        dateFrom: toIsoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)),
        dateTo,
      };
  }
}

export function isValidCustomRange(range: Required<StatsDateRange>): boolean {
  const isValidDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00`);
    return !Number.isNaN(date.getTime()) && toIsoDate(date) === value;
  };
  return isValidDate(range.dateFrom) && isValidDate(range.dateTo) && range.dateFrom <= range.dateTo;
}

export function formatPeriodRange(range: StatsDateRange): string {
  if (!range.dateFrom && !range.dateTo) return 'За весь час';
  if (range.dateFrom && range.dateTo) return `З ${range.dateFrom} по ${range.dateTo}`;
  return range.dateFrom ? `Від ${range.dateFrom}` : `По ${range.dateTo ?? ''}`;
}

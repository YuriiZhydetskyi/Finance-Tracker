import { STATS_PERIODS, type StatsPeriod } from './stats-period';

const STORAGE_KEY = 'finance-tracker.stats-preferences.v1';

type StatsPreferences = {
  period?: StatsPeriod;
  customRange?: { dateFrom: string; dateTo: string };
  categories?: string[];
  stores?: string[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function asCustomRange(value: unknown): { dateFrom: string; dateTo: string } | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.dateFrom !== 'string' || typeof candidate.dateTo !== 'string') {
    return undefined;
  }
  return { dateFrom: candidate.dateFrom, dateTo: candidate.dateTo };
}

export function loadStatsPreferences(): StatsPreferences {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return {};
    const candidate = value as Record<string, unknown>;
    const customRange = asCustomRange(candidate.customRange);
    return {
      ...(typeof candidate.period === 'string' &&
      STATS_PERIODS.includes(candidate.period as StatsPeriod)
        ? { period: candidate.period as StatsPeriod }
        : {}),
      ...(customRange ? { customRange } : {}),
      ...(isStringArray(candidate.categories) ? { categories: candidate.categories } : {}),
      ...(isStringArray(candidate.stores) ? { stores: candidate.stores } : {}),
    };
  } catch {
    return {};
  }
}

export function saveStatsPreferences(update: StatsPreferences): void {
  if (typeof window === 'undefined') return;
  const next = { ...loadStatsPreferences(), ...update };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

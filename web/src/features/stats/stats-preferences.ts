import type { StatsDateRange, StatsFilters } from './api/stats.types';
import {
  STATS_PERIODS,
  isValidCustomRange,
  periodToDateRange,
  type StatsPeriod,
} from './stats-period';

const STORAGE_KEY = 'finance-tracker.stats-preferences.v1';

export type StatsPreferences = {
  period?: StatsPeriod;
  customRange?: { dateFrom: string; dateTo: string };
  categories?: string[] | undefined;
  stores?: string[] | undefined;
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

function parsePreferences(raw: string | null): StatsPreferences {
  if (!raw) return {};
  try {
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

function readRaw(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// The in-memory snapshot is what the UI reads: it stays referentially stable
// until the stored value changes (this tab's save, another tab, or a direct
// storage edit), and it keeps working for the visit when storage is blocked.
let snapshotRaw: string | null = null;
let snapshot: StatsPreferences = {};
const listeners = new Set<() => void>();

export function loadStatsPreferences(): StatsPreferences {
  const raw = readRaw();
  if (raw !== snapshotRaw) {
    snapshotRaw = raw;
    snapshot = parsePreferences(raw);
  }
  return snapshot;
}

export function saveStatsPreferences(update: StatsPreferences): void {
  const serialized = JSON.stringify({ ...loadStatsPreferences(), ...update });
  if (serialized === snapshotRaw) return;
  snapshot = parsePreferences(serialized);
  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
    snapshotRaw = serialized;
  } catch {
    // Storage may be blocked or full; filters must still work for this visit.
  }
  for (const listener of listeners) listener();
}

export function subscribeStatsPreferences(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function statsFiltersOf(preferences: StatsPreferences): StatsFilters {
  return {
    ...(preferences.categories ? { categories: preferences.categories } : {}),
    ...(preferences.stores ? { stores: preferences.stores } : {}),
  };
}

export function statsDateRangeOf(preferences: StatsPreferences): StatsDateRange | null {
  if (preferences.period !== 'custom') {
    return periodToDateRange(preferences.period ?? 'last-3-months');
  }
  return preferences.customRange && isValidCustomRange(preferences.customRange)
    ? preferences.customRange
    : null;
}

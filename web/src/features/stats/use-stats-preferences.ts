import { useMemo, useSyncExternalStore } from 'react';
import type { StatsDateRange, StatsFilters } from './api/stats.types';
import {
  loadStatsPreferences,
  statsDateRangeOf,
  statsFiltersOf,
  subscribeStatsPreferences,
  type StatsPreferences,
} from './stats-preferences';

export function useStatsPreferences(): StatsPreferences {
  return useSyncExternalStore(subscribeStatsPreferences, loadStatsPreferences);
}

export function useStatsDateRange(): StatsDateRange | null {
  const preferences = useStatsPreferences();
  return useMemo(() => statsDateRangeOf(preferences), [preferences]);
}

export function useStatsFilters(): StatsFilters {
  const preferences = useStatsPreferences();
  return useMemo(() => statsFiltersOf(preferences), [preferences]);
}

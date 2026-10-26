import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { saveStatsPreferences } from './stats-preferences';
import { useStatsDateRange, useStatsFilters, useStatsPreferences } from './use-stats-preferences';

const STORAGE_KEY = 'finance-tracker.stats-preferences.v1';

describe('useStatsPreferences', () => {
  beforeEach(() => window.localStorage.clear());

  it('returns a referentially stable snapshot across renders', () => {
    const { result, rerender } = renderHook(() => useStatsPreferences());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it('re-renders every consumer when preferences are saved', () => {
    const periodHook = renderHook(() => useStatsDateRange());
    const filtersHook = renderHook(() => useStatsFilters());
    expect(filtersHook.result.current).toEqual({});

    act(() => {
      saveStatsPreferences({ period: 'all-time', stores: ['Lidl'] });
    });

    expect(periodHook.result.current).toEqual({});
    expect(filtersHook.result.current).toEqual({ stores: ['Lidl'] });
  });

  it('re-renders when another tab changes the stored preferences', () => {
    const { result } = renderHook(() => useStatsPreferences());
    expect(result.current).toEqual({});

    act(() => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ period: 'last-week' }));
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    });

    expect(result.current).toEqual({ period: 'last-week' });
  });

  it('keeps the derived date range and filters referentially stable', () => {
    const range = renderHook(() => useStatsDateRange());
    const filters = renderHook(() => useStatsFilters());
    const firstRange = range.result.current;
    const firstFilters = filters.result.current;

    range.rerender();
    filters.rerender();

    expect(range.result.current).toBe(firstRange);
    expect(filters.result.current).toBe(firstFilters);
  });
});

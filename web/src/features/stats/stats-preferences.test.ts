import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadStatsPreferences,
  saveStatsPreferences,
  statsDateRangeOf,
  statsFiltersOf,
  subscribeStatsPreferences,
} from './stats-preferences';
import { periodToDateRange } from './stats-period';

const STORAGE_KEY = 'finance-tracker.stats-preferences.v1';

describe('stats preferences', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('preserves the period and independent selections when saving one filter', () => {
    saveStatsPreferences({
      period: 'custom',
      customRange: { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      categories: [],
      stores: ['Lidl'],
    });
    saveStatsPreferences({ stores: ['Aldi'] });
    expect(loadStatsPreferences()).toEqual({
      period: 'custom',
      customRange: { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      categories: [],
      stores: ['Aldi'],
    });
  });

  it('recovers from malformed saved preferences', () => {
    window.localStorage.setItem('finance-tracker.stats-preferences.v1', '{broken');
    expect(loadStatsPreferences()).toEqual({});
  });

  it('does not interrupt filter updates when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    });
    expect(() => saveStatsPreferences({ period: 'last-week' })).not.toThrow();
  });

  it('returns the same snapshot object until the stored value changes', () => {
    saveStatsPreferences({ period: 'last-week' });
    const first = loadStatsPreferences();

    expect(loadStatsPreferences()).toBe(first);

    saveStatsPreferences({ stores: ['Lidl'] });
    expect(loadStatsPreferences()).not.toBe(first);
    expect(loadStatsPreferences()).toEqual({ period: 'last-week', stores: ['Lidl'] });
  });

  it('notifies subscribers about saves until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStatsPreferences(listener);

    saveStatsPreferences({ period: 'last-month' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    saveStatsPreferences({ period: 'last-week' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify or replace the snapshot when a save changes nothing', () => {
    saveStatsPreferences({ period: 'last-month' });
    const snapshot = loadStatsPreferences();
    const listener = vi.fn();
    const unsubscribe = subscribeStatsPreferences(listener);

    saveStatsPreferences({ period: 'last-month' });

    expect(listener).not.toHaveBeenCalled();
    expect(loadStatsPreferences()).toBe(snapshot);
    unsubscribe();
  });

  it('drops a key saved as undefined', () => {
    saveStatsPreferences({ categories: ['Хліб'], stores: ['Lidl'] });
    saveStatsPreferences({ categories: undefined });
    expect(loadStatsPreferences()).toEqual({ stores: ['Lidl'] });
  });

  it('follows changes made in another tab through the storage event', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStatsPreferences(listener);

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ period: 'all-time' }));
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(loadStatsPreferences()).toEqual({ period: 'all-time' });
    unsubscribe();
  });

  it('ignores storage events for unrelated keys', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeStatsPreferences(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: 'something-else' }));

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('keeps serving the new value for the visit when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError');
    });
    const listener = vi.fn();
    const unsubscribe = subscribeStatsPreferences(listener);

    saveStatsPreferences({ period: 'last-week' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(loadStatsPreferences()).toEqual({ period: 'last-week' });
    unsubscribe();

    // Re-sync the module snapshot with the (cleared) storage for later tests.
    vi.restoreAllMocks();
    saveStatsPreferences({});
  });

  it('derives the filters from the saved selections only', () => {
    expect(statsFiltersOf({})).toEqual({});
    expect(statsFiltersOf({ period: 'last-week', categories: [], stores: ['Lidl'] })).toEqual({
      categories: [],
      stores: ['Lidl'],
    });
  });

  it('derives the date range from the saved period', () => {
    expect(statsDateRangeOf({ period: 'all-time' })).toEqual({});
    expect(statsDateRangeOf({})).toEqual(periodToDateRange('last-3-months'));
    expect(statsDateRangeOf({ period: 'custom' })).toBeNull();
    expect(
      statsDateRangeOf({
        period: 'custom',
        customRange: { dateFrom: '2026-08-31', dateTo: '2026-08-01' },
      }),
    ).toBeNull();
    expect(
      statsDateRangeOf({
        period: 'custom',
        customRange: { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      }),
    ).toEqual({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
  });
});

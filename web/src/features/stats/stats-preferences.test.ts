import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStatsPreferences, saveStatsPreferences } from './stats-preferences';

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
});

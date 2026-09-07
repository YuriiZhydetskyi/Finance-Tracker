import { describe, expect, it } from 'vitest';
import { isValidCustomRange, periodToDateRange } from './stats-period';

describe('periodToDateRange', () => {
  const today = new Date(2026, 8, 7);

  it('leaves the all-time period unbounded', () => {
    expect(periodToDateRange('all-time', today)).toEqual({});
  });

  it('calculates rolling calendar ranges inclusively', () => {
    expect(periodToDateRange('last-3-months', today)).toEqual({
      dateFrom: '2026-06-07',
      dateTo: '2026-09-07',
    });
    expect(periodToDateRange('last-month', today)).toEqual({
      dateFrom: '2026-08-07',
      dateTo: '2026-09-07',
    });
    expect(periodToDateRange('last-week', today)).toEqual({
      dateFrom: '2026-09-01',
      dateTo: '2026-09-07',
    });
  });

  it('keeps the same day where a shorter target month permits it', () => {
    expect(periodToDateRange('last-month', new Date(2026, 2, 31))).toEqual({
      dateFrom: '2026-02-28',
      dateTo: '2026-03-31',
    });
  });

  it('counts seven calendar dates across the spring daylight-saving transition', () => {
    expect(periodToDateRange('last-week', new Date(2026, 2, 30, 0, 30))).toEqual({
      dateFrom: '2026-03-24',
      dateTo: '2026-03-30',
    });
  });
});

describe('isValidCustomRange', () => {
  it('requires an ascending inclusive range', () => {
    expect(isValidCustomRange({ dateFrom: '2026-08-01', dateTo: '2026-08-01' })).toBe(true);
    expect(isValidCustomRange({ dateFrom: '2026-08-02', dateTo: '2026-08-01' })).toBe(false);
  });

  it.each(['', 'invalid', '2026-02-30', '2026-13-01'])(
    'rejects invalid saved dates: %s',
    (dateFrom) => {
      expect(isValidCustomRange({ dateFrom, dateTo: '2026-12-31' })).toBe(false);
    },
  );
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TIMEZONE, nowIso, todayIso } from './time';

afterEach(() => {
  vi.useRealTimers();
});

describe('nowIso', () => {
  it('returns an ISO 8601 instant in UTC (Z-suffixed)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-04T14:30:45.123Z'));
    expect(nowIso()).toBe('2026-05-04T14:30:45.123Z');
  });

  it('updates when the clock advances', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-04T14:30:00Z'));
    const a = nowIso();
    vi.advanceTimersByTime(1500);
    const b = nowIso();
    expect(a).not.toBe(b);
  });
});

describe('todayIso', () => {
  it('defaults to Europe/Berlin and returns YYYY-MM-DD', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-04T12:00:00Z'));
    const out = todayIso();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out).toBe('2026-05-04');
  });

  it('uses DEFAULT_TIMEZONE when no argument passed', () => {
    expect(DEFAULT_TIMEZONE).toBe('Europe/Berlin');
  });

  it('returns next day in Berlin when UTC is still on the previous day late at night', () => {
    // 2026-01-15 23:30 UTC = 2026-01-16 00:30 Berlin (CET = UTC+1)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T23:30:00Z'));
    expect(todayIso('UTC')).toBe('2026-01-15');
    expect(todayIso('Europe/Berlin')).toBe('2026-01-16');
  });

  it('returns previous day in Los Angeles when Berlin is in early morning', () => {
    // 2026-05-04 03:00 Berlin (= 01:00 UTC = 18:00 PDT 2026-05-03)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-04T01:00:00Z'));
    expect(todayIso('Europe/Berlin')).toBe('2026-05-04');
    expect(todayIso('America/Los_Angeles')).toBe('2026-05-03');
  });

  it('produces a stable date around the spring DST transition in Berlin', () => {
    // 2026-03-29 01:30 UTC = 02:30 CET, then jumps to 03:30 CEST.
    // Either side of the jump the calendar date is still 2026-03-29.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T01:30:00Z'));
    expect(todayIso('Europe/Berlin')).toBe('2026-03-29');
    vi.setSystemTime(new Date('2026-03-29T02:30:00Z'));
    expect(todayIso('Europe/Berlin')).toBe('2026-03-29');
  });
});

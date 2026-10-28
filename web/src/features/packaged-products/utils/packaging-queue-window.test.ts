import { describe, expect, it } from 'vitest';
import {
  PACKAGING_QUEUE_WINDOW_DAYS,
  packagingQueueRowsSince,
  packagingQueueScope,
  packagingQueueWindowStart,
} from './packaging-queue-window';

describe('packagingQueueScope', () => {
  it('searches across all rows as soon as something is typed, whatever the toggle says', () => {
    expect(packagingQueueScope('pesto', false)).toBe('search');
    expect(packagingQueueScope('pesto', true)).toBe('search');
  });

  it('treats a blank query as no search', () => {
    expect(packagingQueueScope('   ', false)).toBe('recent');
    expect(packagingQueueScope('', true)).toBe('all');
  });

  it('defaults to the recent window', () => {
    expect(packagingQueueScope('', false)).toBe('recent');
  });
});

describe('packagingQueueWindowStart', () => {
  it('goes back 30 days by default', () => {
    expect(PACKAGING_QUEUE_WINDOW_DAYS).toBe(30);
    expect(packagingQueueWindowStart(new Date(2026, 9, 27, 15, 30))).toBe('2026-09-27');
  });

  it('crosses month and year boundaries', () => {
    expect(packagingQueueWindowStart(new Date(2026, 0, 10))).toBe('2025-12-11');
    expect(packagingQueueWindowStart(new Date(2026, 2, 1))).toBe('2026-01-30');
  });

  it('ignores the time of day', () => {
    expect(packagingQueueWindowStart(new Date(2026, 9, 27, 0, 0, 1))).toBe(
      packagingQueueWindowStart(new Date(2026, 9, 27, 23, 59, 59)),
    );
  });

  it('keeps the calendar day across the autumn clock change', () => {
    // Europe/Berlin falls back on 2026-10-25; 30 days before 2026-11-24 is still 2026-10-25.
    expect(packagingQueueWindowStart(new Date(2026, 10, 24, 12))).toBe('2026-10-25');
  });

  it('accepts another window length', () => {
    expect(packagingQueueWindowStart(new Date(2026, 9, 27), 7)).toBe('2026-10-20');
  });
});

describe('packagingQueueRowsSince', () => {
  it('limits only the default recent view', () => {
    expect(packagingQueueRowsSince('recent', '2026-09-27')).toBe('2026-09-27');
    expect(packagingQueueRowsSince('all', '2026-09-27')).toBeUndefined();
    expect(packagingQueueRowsSince('search', '2026-09-27')).toBeUndefined();
  });
});

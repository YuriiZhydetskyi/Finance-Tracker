import { describe, it, expect } from 'vitest';
import { formatDate } from './format-date';

describe('formatDate', () => {
  it('formats ISO date with default uk-UA locale', () => {
    const out = formatDate('2026-05-07');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/07/);
  });

  it('uses UTC parsing (no timezone drift)', () => {
    // 2026-01-01 must format as January regardless of local TZ
    const out = formatDate('2026-01-01', 'en-US');
    expect(out).toMatch(/Jan/);
  });

  it('returns original string for malformed input', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
    expect(formatDate('')).toBe('');
  });

  it('caches the formatter per locale', () => {
    // Call twice with same locale; result should be identical (smoke check on cache)
    expect(formatDate('2026-05-07', 'en-GB')).toBe(formatDate('2026-05-07', 'en-GB'));
  });
});

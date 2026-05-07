import { describe, it, expect } from 'vitest';
import { isValidConsumedBy, parseConsumedBy } from './consumed-by';

describe('parseConsumedBy', () => {
  it('parses simple types', () => {
    expect(parseConsumedBy('shared')).toEqual({ type: 'shared' });
    expect(parseConsumedBy('his')).toEqual({ type: 'his' });
    expect(parseConsumedBy('hers')).toEqual({ type: 'hers' });
  });

  it('parses custom split with valid sums', () => {
    expect(parseConsumedBy('custom:30/70')).toEqual({
      type: 'custom',
      hisShare: 30,
      hersShare: 70,
    });
    expect(parseConsumedBy('custom:0/100')).toEqual({
      type: 'custom',
      hisShare: 0,
      hersShare: 100,
    });
  });

  it('rejects custom shares that do not sum to 100', () => {
    expect(() => parseConsumedBy('custom:30/40')).toThrow(/sum to 100/);
    expect(() => parseConsumedBy('custom:60/50')).toThrow(/sum to 100/);
  });

  it('rejects malformed input', () => {
    expect(() => parseConsumedBy('foo')).toThrow(/Invalid consumed_by/);
    expect(() => parseConsumedBy('custom:abc/def')).toThrow(/Invalid consumed_by/);
    expect(() => parseConsumedBy('')).toThrow(/Invalid consumed_by/);
  });
});

describe('isValidConsumedBy', () => {
  it('returns true for accepted shapes', () => {
    expect(isValidConsumedBy('his')).toBe(true);
    expect(isValidConsumedBy('hers')).toBe(true);
    expect(isValidConsumedBy('shared')).toBe(true);
    expect(isValidConsumedBy('custom:30/70')).toBe(true);
    expect(isValidConsumedBy('custom:0/100')).toBe(true);
  });

  it('returns false for invalid shapes', () => {
    expect(isValidConsumedBy('foo')).toBe(false);
    expect(isValidConsumedBy('custom:30/40')).toBe(false);
    expect(isValidConsumedBy('')).toBe(false);
  });
});

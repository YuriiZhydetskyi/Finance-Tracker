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

  it('accepts boundary 100/0', () => {
    expect(parseConsumedBy('custom:100/0')).toEqual({
      type: 'custom',
      hisShare: 100,
      hersShare: 0,
    });
  });

  it('rejects negative shares (regex \\d+ blocks the leading minus)', () => {
    expect(() => parseConsumedBy('custom:-10/110')).toThrow(/Invalid consumed_by/);
    expect(() => parseConsumedBy('custom:50/-50')).toThrow(/Invalid consumed_by/);
  });

  it('rejects whitespace inside the custom expression', () => {
    expect(() => parseConsumedBy('custom: 30 / 70')).toThrow(/Invalid consumed_by/);
    expect(() => parseConsumedBy(' custom:30/70')).toThrow(/Invalid consumed_by/);
  });

  it('accepts leading-zero shares (parsed as decimal)', () => {
    // \\d+ matches '01' which parseInt reads as 1, so 01/99 is valid (sum=100).
    // Documenting current behaviour — may want to tighten regex if surprising.
    expect(parseConsumedBy('custom:01/99')).toEqual({
      type: 'custom',
      hisShare: 1,
      hersShare: 99,
    });
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

import { describe, it, expect } from 'vitest';
import { roundFxRate, roundMoney, roundQty } from './money';

describe('roundMoney', () => {
  it('handles classic float drift (0.1 + 0.2 → 0.3)', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it('rounds half away from zero at 2dp', () => {
    expect(roundMoney(3.494)).toBe(3.49);
    expect(roundMoney(3.499)).toBe(3.5);
  });

  it('handles zero and negatives', () => {
    expect(roundMoney(0)).toBe(0);
    expect(roundMoney(-1.234)).toBe(-1.23);
  });
});

describe('roundQty', () => {
  it('rounds to 3dp', () => {
    expect(roundQty(1.2345)).toBe(1.235);
    expect(roundQty(0.0001)).toBe(0);
  });
});

describe('roundFxRate', () => {
  it('rounds to 6dp', () => {
    expect(roundFxRate(0.0245312345)).toBe(0.024531);
  });

  it('returns 0 for 0 input (does not throw)', () => {
    // factory layer rejects fx=0 via Zod; the rounder itself should be total.
    expect(roundFxRate(0)).toBe(0);
  });
});

// ── Pathological inputs ─────────────────────────────────────────────────────
// These don't normally occur (factory + Zod gate them), but the rounders are
// the foundation of every money write — confirm they don't quietly mask NaN.

describe('roundMoney — pathological inputs', () => {
  it('NaN propagates as NaN (not silently coerced to 0)', () => {
    expect(Number.isNaN(roundMoney(Number.NaN))).toBe(true);
  });

  it('Infinity propagates as Infinity', () => {
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
    expect(roundMoney(Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('handles values near MAX_SAFE_INTEGER without throwing', () => {
    // Very large × 100 may overflow precision but should still be a finite number.
    const out = roundMoney(Number.MAX_SAFE_INTEGER / 1000);
    expect(Number.isFinite(out)).toBe(true);
  });
});

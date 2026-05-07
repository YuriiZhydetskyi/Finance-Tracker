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
});

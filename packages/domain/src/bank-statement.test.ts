import { describe, it, expect } from 'vitest';
import {
  BankStatementSchema,
  normalizeStatementTxns,
  toStatementTxns,
  type BankStatementTxn,
} from './bank-statement';

describe('toStatementTxns', () => {
  it('passes a bare array through', () => {
    const arr = [{ date: '2026-05-01', amount: 1, currency: 'EUR' }];
    expect(toStatementTxns(arr)).toBe(arr);
  });

  it('unwraps a { transactions: [...] } wrapper', () => {
    const txns = [{ date: '2026-05-01', amount: 1, currency: 'EUR' }];
    expect(toStatementTxns({ transactions: txns })).toBe(txns);
  });

  it('returns [] for an object without transactions or a non-object', () => {
    expect(toStatementTxns({ foo: 1 })).toEqual([]);
    expect(toStatementTxns('nope')).toEqual([]);
    expect(toStatementTxns(null)).toEqual([]);
  });
});

describe('BankStatementSchema', () => {
  it('accepts a minimal valid transaction list', () => {
    const result = BankStatementSchema.safeParse([
      { date: '2026-05-25', amount: 12.34, currency: 'EUR' },
    ]);
    expect(result.success).toBe(true);
  });

  it('upper-cases the currency code', () => {
    const result = BankStatementSchema.parse([{ date: '2026-05-25', amount: 1, currency: 'eur' }]);
    expect(result[0]?.currency).toBe('EUR');
  });

  it('rejects missing required fields with the path in the issue', () => {
    const result = BankStatementSchema.safeParse([{ date: '2026-05-25', currency: 'EUR' }]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('amount'))).toBe(true);
    }
  });

  it('rejects a malformed date / currency', () => {
    expect(
      BankStatementSchema.safeParse([{ date: '25.05.2026', amount: 1, currency: 'EUR' }]).success,
    ).toBe(false);
    expect(
      BankStatementSchema.safeParse([{ date: '2026-05-25', amount: 1, currency: 'EURO' }]).success,
    ).toBe(false);
  });

  it('accepts optional time / merchant / raw and omitting them', () => {
    const withExtras = BankStatementSchema.safeParse([
      {
        date: '2026-05-25',
        amount: 1,
        currency: 'EUR',
        time: '14:32',
        merchant: 'Lidl',
        raw: 'LIDL SAGT DANKE',
      },
    ]);
    expect(withExtras.success).toBe(true);
    const without = BankStatementSchema.safeParse([
      { date: '2026-05-25', amount: 1, currency: 'EUR' },
    ]);
    expect(without.success).toBe(true);
  });
});

describe('normalizeStatementTxns', () => {
  const base: BankStatementTxn[] = [
    { date: '2026-05-25', amount: 12.345, currency: 'EUR' },
    { date: '2026-05-26', amount: -9.9, currency: 'EUR', time: '08:01', merchant: 'Aldi' },
  ];

  it('rounds the absolute amount to 2dp and flags refunds', () => {
    const out = normalizeStatementTxns(base);
    expect(out[0]).toMatchObject({
      index: 0,
      amount: 12.35,
      isRefund: false,
      time: null,
      merchant: null,
    });
    expect(out[1]).toMatchObject({
      index: 1,
      amount: 9.9,
      isRefund: true,
      time: '08:01',
      merchant: 'Aldi',
    });
  });

  it('keeps the original index for mapping results back', () => {
    const out = normalizeStatementTxns(base);
    expect(out.map((t) => t.index)).toEqual([0, 1]);
  });
});

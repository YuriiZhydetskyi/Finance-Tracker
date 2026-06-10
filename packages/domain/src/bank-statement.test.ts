import { describe, it, expect } from 'vitest';
import {
  BankStatementSchema,
  dedupOccurrences,
  groupStatementDuplicates,
  normalizeStatementTxns,
  statementDedupKey,
  toStatementTxns,
  type BankStatementTxn,
  type NormalizedStatementTxn,
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

  it('carries the AI category through, defaulting to null', () => {
    const out = normalizeStatementTxns([
      { date: '2026-05-25', amount: 1, currency: 'EUR', category: 'Кафе/ресторани' },
      { date: '2026-05-26', amount: 2, currency: 'EUR' },
    ]);
    expect(out[0]?.category).toBe('Кафе/ресторани');
    expect(out[1]?.category).toBe(null);
  });
});

describe('dedupOccurrences / statementDedupKey', () => {
  it('numbers genuine same-import duplicates 0, 1, … and others 0', () => {
    const items = [
      { date: '2026-05-25', amount: 2.5, currency: 'EUR', merchant: 'Lidl', raw: null },
      { date: '2026-05-25', amount: 2.5, currency: 'EUR', merchant: 'Lidl', raw: null }, // dup
      { date: '2026-05-25', amount: 9.9, currency: 'EUR', merchant: 'Aldi', raw: null }, // distinct
    ];
    expect(dedupOccurrences(items)).toEqual([0, 1, 0]);
  });

  it('produces distinct keys for duplicates and identical keys across re-imports', () => {
    const a = statementDedupKey('2026-05-25', 2.5, 'EUR', 'Lidl', null, 0);
    const b = statementDedupKey('2026-05-25', 2.5, 'EUR', 'Lidl', null, 1);
    expect(a).not.toBe(b);
    // A re-import reproduces the same identity + occurrence → same key (upsert dedups).
    expect(statementDedupKey('2026-05-25', 2.5, 'EUR', 'lidl', null, 0)).toBe(a);
  });

  it('treats merchant case/whitespace as the same identity', () => {
    const items = [
      { date: '2026-05-25', amount: 2.5, currency: 'EUR', merchant: 'LIDL', raw: null },
      { date: '2026-05-25', amount: 2.5, currency: 'EUR', merchant: ' lidl ', raw: null },
    ];
    expect(dedupOccurrences(items)).toEqual([0, 1]);
  });
});

describe('groupStatementDuplicates', () => {
  const mk = (
    over: Partial<NormalizedStatementTxn> & { index: number },
  ): NormalizedStatementTxn => ({
    date: '2026-05-25',
    amount: 10,
    currency: 'EUR',
    time: null,
    merchant: null,
    raw: null,
    category: null,
    isRefund: false,
    ...over,
  });

  it('groups same-identity lines and skips singletons', () => {
    const groups = groupStatementDuplicates([
      mk({ index: 0, merchant: 'Lidl' }),
      mk({ index: 1, merchant: 'Aldi' }),
      mk({ index: 2, merchant: 'LIDL' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.map((t) => t.index)).toEqual([0, 2]);
  });

  it('returns [] when every line is unique', () => {
    expect(
      groupStatementDuplicates([mk({ index: 0, amount: 1 }), mk({ index: 1, amount: 2 })]),
    ).toEqual([]);
  });

  it('separates lines that differ only in date or amount', () => {
    expect(
      groupStatementDuplicates([
        mk({ index: 0, merchant: 'Lidl' }),
        mk({ index: 1, merchant: 'Lidl', date: '2026-05-26' }),
        mk({ index: 2, merchant: 'Lidl', amount: 9.99 }),
      ]),
    ).toEqual([]);
  });

  it('does not pair a purchase with a refund of the same amount and label', () => {
    expect(
      groupStatementDuplicates([
        mk({ index: 0, merchant: 'Zara' }),
        mk({ index: 1, merchant: 'Zara', isRefund: true }),
      ]),
    ).toEqual([]);
  });

  it('keeps a 3+ duplicate group together in input order', () => {
    const groups = groupStatementDuplicates([
      mk({ index: 0, raw: 'TGTG' }),
      mk({ index: 1, raw: 'TGTG' }),
      mk({ index: 2, raw: 'TGTG' }),
    ]);
    expect(groups[0]?.map((t) => t.index)).toEqual([0, 1, 2]);
  });
});

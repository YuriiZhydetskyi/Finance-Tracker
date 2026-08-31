import { describe, it, expect } from 'vitest';
import type { Receipt } from './schemas';
import type { NormalizedStatementTxn } from './bank-statement';
import { makeStoreAliasKey } from './store-match';
import { reconcileStatement } from './reconcile-statement';

const OWNER = 'b@example.com';
const OTHER = 'a@example.com';

function mkReceipt(over: Partial<Receipt> & Pick<Receipt, 'id'>): Receipt {
  return {
    date: '2026-05-25',
    store: 'Lidl',
    store_address: null,
    currency: 'EUR',
    total_orig: 10,
    fx_rate_eur: 1,
    total_eur: 10,
    paid_by: OTHER,
    photo_url: null,
    photo_path: null,
    source: 'photo',
    raw_ocr_json: null,
    note: null,
    time: null,
    created_at: '2026-05-25T10:00:00Z',
    updated_at: '2026-05-25T10:00:00Z',
    ...over,
  };
}

function mkTxn(over: Partial<NormalizedStatementTxn> & { index: number }): NormalizedStatementTxn {
  return {
    date: '2026-05-25',
    amount: 10,
    currency: 'EUR',
    time: null,
    merchant: null,
    raw: null,
    category: null,
    isRefund: false,
    ...over,
  };
}

describe('reconcileStatement', () => {
  it('proposes a flip when a same-day exact match is paid by someone else', () => {
    const res = reconcileStatement([mkTxn({ index: 0 })], [mkReceipt({ id: 'r1' })], OWNER);
    expect(res.toFix).toHaveLength(1);
    expect(res.toFix[0]).toMatchObject({ from: OTHER, to: OWNER, dateGap: 0, confidence: 'high' });
    expect(res.toFix[0]?.receipt.id).toBe('r1');
  });

  it('marks an exact match already paid by the owner as alreadyCorrect (no flip)', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0 })],
      [mkReceipt({ id: 'r1', paid_by: OWNER })],
      OWNER,
    );
    expect(res.toFix).toHaveLength(0);
    expect(res.alreadyCorrect).toHaveLength(1);
    expect(res.alreadyCorrect[0]?.receipt.id).toBe('r1');
  });

  it('matches across a posting lag within the window and reflects the gap in confidence', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, date: '2026-05-27' })],
      [mkReceipt({ id: 'r1', date: '2026-05-25' })],
      OWNER,
    );
    expect(res.toFix).toHaveLength(1);
    expect(res.toFix[0]).toMatchObject({ dateGap: 2, confidence: 'low' });
  });

  it('does not match beyond the date window', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, date: '2026-05-29' })], // 4 days from receipt, window 3
      [mkReceipt({ id: 'r1', date: '2026-05-25' })],
      OWNER,
    );
    expect(res.toFix).toHaveLength(0);
    expect(res.unmatchedStatementLines).toHaveLength(1);
    expect(res.unmatchedStatementLines[0]?.reason).toBe('no-candidate');
    expect(res.unmatchedStatementLines[0]?.txn.index).toBe(0);
  });

  it('does not match on currency mismatch', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, currency: 'USD' })],
      [mkReceipt({ id: 'r1', currency: 'EUR' })],
      OWNER,
    );
    expect(res.toFix).toHaveLength(0);
    expect(res.unmatchedStatementLines[0]?.reason).toBe('no-candidate');
  });

  it('does not match when the amount is off by a cent (no fuzzy tolerance)', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, amount: 10.01 })],
      [mkReceipt({ id: 'r1', total_orig: 10 })],
      OWNER,
    );
    expect(res.toFix).toHaveLength(0);
  });

  it('matches through floating-point noise after rounding', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, amount: 10.1 + 0.2 })], // 10.299999999999999
      [mkReceipt({ id: 'r1', total_orig: 10.3 })],
      OWNER,
    );
    expect(res.toFix).toHaveLength(1);
  });

  it('flags two equally-good receipts as ambiguous and proposes nothing', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0 })],
      [mkReceipt({ id: 'r1' }), mkReceipt({ id: 'r2' })],
      OWNER,
    );
    expect(res.toFix).toHaveLength(0);
    expect(res.ambiguous).toHaveLength(1);
    expect(res.ambiguous[0]?.candidates.map((c) => c.receipt.id).sort()).toEqual(['r1', 'r2']);
  });

  it('picks the smaller date gap over a farther receipt (not ambiguous)', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, date: '2026-05-25' })],
      [mkReceipt({ id: 'near', date: '2026-05-25' }), mkReceipt({ id: 'far', date: '2026-05-23' })],
      OWNER,
    );
    expect(res.ambiguous).toHaveLength(0);
    expect(res.toFix).toHaveLength(1);
    expect(res.toFix[0]?.receipt.id).toBe('near');
  });

  it('uses time only as a tiebreaker within an equal date gap', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, time: '14:00' })],
      [mkReceipt({ id: 'close', time: '14:05' }), mkReceipt({ id: 'farTime', time: '16:00' })],
      OWNER,
    );
    expect(res.ambiguous).toHaveLength(0);
    expect(res.toFix[0]?.receipt.id).toBe('close');
  });

  it('does not let one receipt be assigned to two statement lines', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0 }), mkTxn({ index: 1 })],
      [mkReceipt({ id: 'r1' })],
      OWNER,
    );
    expect(res.toFix).toHaveLength(1);
    expect(res.unmatchedStatementLines).toHaveLength(1);
    expect(res.unmatchedStatementLines[0]?.reason).toBe('receipt-taken');
    expect(res.unmatchedStatementLines[0]?.txn.index).toBe(1);
  });

  it('assigns two lines to two receipts without double-counting', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, time: '14:00' }), mkTxn({ index: 1, time: '18:00' })],
      [
        mkReceipt({ id: 'r1', time: '14:01', created_at: '2026-05-25T14:01:00Z' }),
        mkReceipt({ id: 'r2', time: '18:01', created_at: '2026-05-25T18:01:00Z' }),
      ],
      OWNER,
    );
    expect(res.toFix).toHaveLength(2);
    const assigned = res.toFix.map((f) => f.receipt.id).sort();
    expect(assigned).toEqual(['r1', 'r2']);
  });

  it('resolves a tie when another line forces one of the candidates (greedy re-evaluation)', () => {
    const txns = [
      mkTxn({ index: 0, date: '2026-05-25' }), // ties r1(gap1) and r2(gap1)
      mkTxn({ index: 1, date: '2026-05-24' }), // best is r1(gap0), which forces line 0 onto r2
    ];
    const receipts = [
      mkReceipt({ id: 'r1', date: '2026-05-24' }),
      mkReceipt({ id: 'r2', date: '2026-05-26' }),
    ];
    const res = reconcileStatement(txns, receipts, OWNER);
    expect(res.ambiguous).toHaveLength(0);
    expect(res.toFix).toHaveLength(2);
    const assignment = new Map(res.toFix.map((f) => [f.txn.index, f.receipt.id]));
    expect(assignment.get(1)).toBe('r1');
    expect(assignment.get(0)).toBe('r2');
  });

  it('prefers a receipt whose time corroborates over one with no recorded time', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, time: '14:00' })],
      [
        mkReceipt({ id: 'timed', time: '14:03' }), // close time → should win
        mkReceipt({ id: 'untimed', time: null }), // no time → neutral, must not outrank a match
      ],
      OWNER,
    );
    expect(res.ambiguous).toHaveLength(0);
    expect(res.toFix).toHaveLength(1);
    expect(res.toFix[0]?.receipt.id).toBe('timed');
  });

  it('buckets refund (negative) statement lines separately and never proposes a flip', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, isRefund: true })],
      [mkReceipt({ id: 'r1' })],
      OWNER,
    );
    expect(res.toFix).toHaveLength(0);
    expect(res.unmatchedStatementLines).toHaveLength(1);
    expect(res.unmatchedStatementLines[0]?.reason).toBe('refund');
    expect(res.unmatchedStatementLines[0]?.txn.index).toBe(0);
  });

  it('is idempotent: a flipped receipt re-runs as alreadyCorrect', () => {
    const txns = [mkTxn({ index: 0 })];
    const before = reconcileStatement(txns, [mkReceipt({ id: 'r1', paid_by: OTHER })], OWNER);
    expect(before.toFix).toHaveLength(1);
    const after = reconcileStatement(txns, [mkReceipt({ id: 'r1', paid_by: OWNER })], OWNER);
    expect(after.toFix).toHaveLength(0);
    expect(after.alreadyCorrect).toHaveLength(1);
  });

  it('is deterministic regardless of receipt input order', () => {
    const txns = [mkTxn({ index: 0, time: '14:00' }), mkTxn({ index: 1, time: '18:00' })];
    const receipts = [
      mkReceipt({ id: 'r1', time: '14:01', created_at: '2026-05-25T14:01:00Z' }),
      mkReceipt({ id: 'r2', time: '18:01', created_at: '2026-05-25T18:01:00Z' }),
    ];
    const a = reconcileStatement(txns, receipts, OWNER);
    const b = reconcileStatement(txns, [...receipts].reverse(), OWNER);
    const ids = (r: typeof a) => r.toFix.map((f) => `${f.txn.index}:${f.receipt.id}`).sort();
    expect(ids(a)).toEqual(ids(b));
  });

  it('honors a custom date window', () => {
    const txn = [mkTxn({ index: 0, date: '2026-05-30' })]; // 5 days out
    const receipts = [mkReceipt({ id: 'r1', date: '2026-05-25' })];
    expect(reconcileStatement(txn, receipts, OWNER).toFix).toHaveLength(0);
    expect(reconcileStatement(txn, receipts, OWNER, { dateWindowDays: 7 }).toFix).toHaveLength(1);
  });

  it('flags storeMatch=true when the merchant name matches the receipt store', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, merchant: 'MCDONALDS 123 BERLIN' })],
      [mkReceipt({ id: 'r1', store: "McDonald's" })],
      OWNER,
    );
    expect(res.toFix).toHaveLength(1);
    expect(res.toFix[0]?.storeMatch).toBe(true);
  });

  it('flags storeMatch=false when date+amount match but the store differs', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, merchant: 'REWE' })],
      [mkReceipt({ id: 'r1', store: 'Lidl' })],
      OWNER,
    );
    expect(res.toFix).toHaveLength(1);
    expect(res.toFix[0]?.storeMatch).toBe(false);
  });

  it('falls back to the raw description when merchant is null', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, merchant: null, raw: 'LIDL DIENSTLEISTUNG SAGT DANKE' })],
      [mkReceipt({ id: 'r1', store: 'Lidl' })],
      OWNER,
    );
    expect(res.toFix[0]?.storeMatch).toBe(true);
  });

  it('flags storeMatch=true via a learned alias when the names share no token', () => {
    const txns = [mkTxn({ index: 0, merchant: 'AMZN MKTP DE' })];
    const receipts = [mkReceipt({ id: 'r1', store: 'Amazon' })];
    const without = reconcileStatement(txns, receipts, OWNER);
    expect(without.toFix[0]?.storeMatch).toBe(false);
    const withAliases = reconcileStatement(txns, receipts, OWNER, {
      storeAliasKeys: new Set([makeStoreAliasKey('AMZN MKTP DE', 'Amazon')]),
    });
    expect(withAliases.toFix[0]?.storeMatch).toBe(true);
  });

  it('carries storeMatch on alreadyCorrect links too', () => {
    const res = reconcileStatement(
      [mkTxn({ index: 0, merchant: 'LIDL' })],
      [mkReceipt({ id: 'r1', store: 'Lidl', paid_by: OWNER })],
      OWNER,
    );
    expect(res.alreadyCorrect[0]?.storeMatch).toBe(true);
  });

  it('returns empty buckets for empty inputs', () => {
    const res = reconcileStatement([], [], OWNER);
    expect(res).toEqual({
      toFix: [],
      alreadyCorrect: [],
      ambiguous: [],
      unmatchedStatementLines: [],
    });
  });
});

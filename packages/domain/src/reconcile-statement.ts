// Reconcile a card statement against existing receipts to correct `paid_by`.
//
// A statement belongs to ONE person (the `owner`). For each statement transaction
// we find the receipt it paid for (same currency, exact amount, date within a few
// days) and — where that receipt is currently attributed to someone else — propose
// flipping `paid_by` to the owner. Pure, deterministic, vendor-free: all matching
// logic lives here and is unit-tested in isolation (like pair-detector.ts).

import { daysBetweenIso } from './time';
import { roundMoney } from './money';
import type { Receipt } from './schemas';
import type { NormalizedStatementTxn } from './bank-statement';

export const DATE_WINDOW_DAYS = 3;

// Scoring: higher = more confident. A day of date gap (GAP_PENALTY) outweighs the
// largest possible time penalty, so time is a pure tiebreaker within an equal date
// gap and never overrides a closer date.
const BASE_SCORE = 1000;
const GAP_PENALTY = 100;
const TIME_PENALTY_PER_MIN = 0.1;
const TIME_PENALTY_CAP_MIN = 720;
// When a time is missing on either side there's no corroboration. Rank such a
// candidate BELOW a close time match but ABOVE a far one (neutral midpoint) —
// otherwise "no time" would score as a perfect (zero-penalty) match and beat a
// receipt whose recorded time actually corroborates the transaction.
const UNKNOWN_TIME_PENALTY = (TIME_PENALTY_CAP_MIN / 2) * TIME_PENALTY_PER_MIN;

export type Confidence = 'high' | 'medium' | 'low';

export type MatchLink = {
  txn: NormalizedStatementTxn;
  receipt: Receipt;
  dateGap: number;
  score: number;
  confidence: Confidence;
};

export type ToFixEntry = MatchLink & { from: string; to: string };

export type AmbiguousCandidate = { receipt: Receipt; dateGap: number; score: number };
export type AmbiguousEntry = { txn: NormalizedStatementTxn; candidates: AmbiguousCandidate[] };

export type UnmatchedReason = 'no-candidate' | 'receipt-taken' | 'refund';
export type UnmatchedEntry = { txn: NormalizedStatementTxn; reason: UnmatchedReason };

export type ReconcileResult = {
  toFix: ToFixEntry[]; // matched, paid_by !== owner → propose flip
  alreadyCorrect: MatchLink[]; // matched, paid_by === owner → confirmed, no action
  ambiguous: AmbiguousEntry[]; // ≥2 equally-good receipts → manual decision
  unmatchedStatementLines: UnmatchedEntry[]; // no receipt / receipt taken / refund
};

export type ReconcileOptions = { dateWindowDays?: number };

type Candidate = {
  txnIndex: number;
  receiptId: string;
  dateGap: number;
  score: number;
};

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

function timePenalty(txnTime: string | null, receiptTime: string | null): number {
  if (txnTime == null || receiptTime == null) return UNKNOWN_TIME_PENALTY;
  const diff = Math.abs(timeToMinutes(txnTime) - timeToMinutes(receiptTime));
  return Math.min(diff, TIME_PENALTY_CAP_MIN) * TIME_PENALTY_PER_MIN;
}

function scorePair(dateGap: number, txnTime: string | null, receiptTime: string | null): number {
  return BASE_SCORE - dateGap * GAP_PENALTY - timePenalty(txnTime, receiptTime);
}

function confidenceFromGap(gap: number): Confidence {
  if (gap === 0) return 'high';
  if (gap === 1) return 'medium';
  return 'low';
}

export function reconcileStatement(
  txns: NormalizedStatementTxn[],
  receipts: Receipt[],
  owner: string,
  options: ReconcileOptions = {},
): ReconcileResult {
  const window = options.dateWindowDays ?? DATE_WINDOW_DAYS;
  const receiptById = new Map(receipts.map((r) => [r.id, r]));

  // Deterministic ordering so the result is independent of input order: better
  // score first, then smaller gap, then earlier-created receipt, then id. Returns
  // <0 when `a` is the stronger match.
  const compareCandidates = (a: Candidate, b: Candidate): number => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.dateGap !== b.dateGap) return a.dateGap - b.dateGap;
    const ca = receiptById.get(a.receiptId)?.created_at ?? '';
    const cb = receiptById.get(b.receiptId)?.created_at ?? '';
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.receiptId < b.receiptId ? -1 : a.receiptId > b.receiptId ? 1 : 0;
  };

  // 1. Build eligible (txn, receipt) candidate pairs. Refunds are excluded from
  //    matching entirely (handled as a separate bucket) so a refund line can't
  //    consume a receipt that a real purchase line needs.
  const candidates: Candidate[] = [];
  for (const txn of txns) {
    if (txn.isRefund) continue;
    for (const receipt of receipts) {
      if (txn.currency !== receipt.currency) continue;
      if (roundMoney(txn.amount) !== roundMoney(receipt.total_orig)) continue;
      const dateGap = daysBetweenIso(txn.date, receipt.date);
      if (dateGap > window) continue;
      candidates.push({
        txnIndex: txn.index,
        receiptId: receipt.id,
        dateGap,
        score: scorePair(dateGap, txn.time, receipt.time),
      });
    }
  }

  const byTxn = new Map<number, Candidate[]>();
  for (const c of candidates) {
    const arr = byTxn.get(c.txnIndex);
    if (arr) arr.push(c);
    else byTxn.set(c.txnIndex, [c]);
  }

  const consumed = new Set<string>();

  // Among a txn's still-available candidates (receipt not yet consumed), return the
  // single best one only if its top score is unique; tiedCount reports how many
  // share that top score (≥2 ⇒ genuinely ambiguous, can't auto-pick).
  const availableTop = (txnIndex: number): { unique: Candidate | null; tiedCount: number } => {
    const avail = (byTxn.get(txnIndex) ?? []).filter((c) => !consumed.has(c.receiptId));
    if (avail.length === 0) return { unique: null, tiedCount: 0 };
    let best = avail[0] as Candidate;
    for (const c of avail) if (compareCandidates(c, best) < 0) best = c;
    const tiedCount = avail.filter((c) => Math.abs(c.score - best.score) < 1e-9).length;
    return { unique: tiedCount === 1 ? best : null, tiedCount };
  };

  // 2. Iterative greedy: each round assign the globally-best txn that has a single
  //    unambiguous best receipt, consume it, then re-evaluate. A forced one-option
  //    assignment pins/frees receipts so another line's tie can resolve next round
  //    (e.g. A ties R1/R2 while B only matches R1 → B takes R1, then A resolves R2).
  const assignedTxn = new Map<number, Candidate>();
  for (;;) {
    let pick: Candidate | null = null;
    for (const txn of txns) {
      if (txn.isRefund || assignedTxn.has(txn.index)) continue;
      const { unique } = availableTop(txn.index);
      if (unique && (pick === null || compareCandidates(unique, pick) < 0)) pick = unique;
    }
    if (!pick) break;
    assignedTxn.set(pick.txnIndex, pick);
    consumed.add(pick.receiptId);
  }

  // 3. Bucket every statement line.
  const toFix: ToFixEntry[] = [];
  const alreadyCorrect: MatchLink[] = [];
  const ambiguous: AmbiguousEntry[] = [];
  const unmatched: UnmatchedEntry[] = [];

  for (const txn of txns) {
    if (txn.isRefund) {
      unmatched.push({ txn, reason: 'refund' });
      continue;
    }
    const cands = byTxn.get(txn.index) ?? [];
    if (cands.length === 0) {
      unmatched.push({ txn, reason: 'no-candidate' });
      continue;
    }
    const assigned = assignedTxn.get(txn.index);
    if (assigned) {
      const receipt = receiptById.get(assigned.receiptId) as Receipt;
      const link: MatchLink = {
        txn,
        receipt,
        dateGap: assigned.dateGap,
        score: assigned.score,
        confidence: confidenceFromGap(assigned.dateGap),
      };
      if (receipt.paid_by === owner) alreadyCorrect.push(link);
      else toFix.push({ ...link, from: receipt.paid_by, to: owner });
      continue;
    }
    // Unassigned with candidates: ambiguous (≥2 available tied) or all consumed.
    if (availableTop(txn.index).tiedCount >= 2) {
      ambiguous.push({
        txn,
        candidates: cands
          .filter((c) => !consumed.has(c.receiptId))
          .sort(compareCandidates)
          .map((c) => ({
            receipt: receiptById.get(c.receiptId) as Receipt,
            dateGap: c.dateGap,
            score: c.score,
          })),
      });
    } else {
      unmatched.push({ txn, reason: 'receipt-taken' });
    }
  }

  return { toFix, alreadyCorrect, ambiguous, unmatchedStatementLines: unmatched };
}

// Bank/card statement parsing. A statement is a flat list of transactions that
// an external AI extracts from statement screenshots (same copy-the-prompt UX as
// the receipt JSON import). The cardholder is NOT part of the JSON — it's chosen
// in the app (one statement = one person). See reconcile-statement.ts for matching.

import { z } from 'zod';
import { roundMoney } from './money';
import { ISO_DATE_SCHEMA, ISO_TIME_INPUT_SCHEMA } from './schemas';

// Lenient currency: AI statement output is less controlled than receipt parsing,
// so accept any-case 3-letter code and upper-case it. Matching compares against
// receipt.currency (already uppercase).
const STATEMENT_CURRENCY_SCHEMA = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'Must be a 3-letter currency code')
  .transform((s) => s.toUpperCase());

export const BankStatementTxnSchema = z.object({
  date: ISO_DATE_SCHEMA, // YYYY-MM-DD posting date
  amount: z.number().finite(), // signed; matched by abs(), the sign only flags refunds
  currency: STATEMENT_CURRENCY_SCHEMA,
  time: ISO_TIME_INPUT_SCHEMA.nullable().optional(), // HH:MM(:SS), usually absent on statements
  merchant: z.string().nullable().optional(), // display / soft tiebreak only, never gates a match
  raw: z.string().nullable().optional(), // original statement description, display only
  category: z.string().nullable().optional(), // AI's guess at our category for the merchant; fallback for stub receipts
});
export type BankStatementTxn = z.infer<typeof BankStatementTxnSchema>;

export const BankStatementSchema = z.array(BankStatementTxnSchema);

// The matcher input: amount made positive + rounded, refund sign captured, optional
// fields collapsed to null, original index kept so the UI can map results back.
export type NormalizedStatementTxn = {
  index: number;
  date: string;
  amount: number; // abs(amount), rounded to 2dp
  currency: string;
  time: string | null;
  merchant: string | null;
  raw: string | null;
  category: string | null; // AI category guess; only used as a stub-receipt fallback, never for matching
  isRefund: boolean;
};

// One pasted blob may be a bare array of transactions or a { transactions: [...] }
// wrapper. Always returns a flat list of transaction-shaped candidates (or [] when
// neither shape is present), mirroring toReceiptCandidates for the receipt import.
export function toStatementTxns(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const transactions = (value as Record<string, unknown>).transactions;
    if (Array.isArray(transactions)) return transactions;
  }
  return [];
}

// Identity of a statement line, BEFORE disambiguating same-import duplicates:
// the fields a human uses to recognize "the same transaction" — date, rounded
// amount, currency, merchant/raw label lowercased.
function dedupIdentity(
  date: string,
  amount: number,
  currency: string,
  merchant: string | null,
  raw: string | null,
): string {
  const label = (merchant ?? raw ?? '').trim().toLowerCase();
  return `${date}|${roundMoney(amount).toFixed(2)}|${currency}|${label}`;
}

// Stable dedup key for an orphan row. `occurrence` distinguishes genuine same-day
// duplicates within one import (two real identical charges → occurrence 0 and 1,
// both kept) while keeping re-import idempotent: the same statement reproduces the
// same identities in the same order → same occurrences → same keys → the DB's
// unique index + upsert(ignoreDuplicates) drops the repeats. Screenshot-overlap
// duplicates are prevented upstream — the extraction prompt emits each real
// transaction once. The DB has a unique index on this exact string.
export function statementDedupKey(
  date: string,
  amount: number,
  currency: string,
  merchant: string | null,
  raw: string | null,
  occurrence = 0,
): string {
  return `${dedupIdentity(date, amount, currency, merchant, raw)}|${occurrence}`;
}

// Assigns each item its occurrence ordinal among others sharing the same identity,
// in input order. Feed the result as `occurrence` to statementDedupKey / the
// factory so duplicates within one import get distinct keys deterministically.
export function dedupOccurrences(
  items: {
    date: string;
    amount: number;
    currency: string;
    merchant: string | null;
    raw: string | null;
  }[],
): number[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const id = dedupIdentity(it.date, it.amount, it.currency, it.merchant, it.raw);
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return n;
  });
}

export function normalizeStatementTxns(txns: BankStatementTxn[]): NormalizedStatementTxn[] {
  return txns.map((t, index) => ({
    index,
    date: t.date,
    amount: roundMoney(Math.abs(t.amount)),
    currency: t.currency,
    time: t.time ?? null,
    merchant: t.merchant ?? null,
    raw: t.raw ?? null,
    category: t.category ?? null,
    isRefund: t.amount < 0,
  }));
}

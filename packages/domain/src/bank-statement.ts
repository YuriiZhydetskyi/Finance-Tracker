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

export function normalizeStatementTxns(txns: BankStatementTxn[]): NormalizedStatementTxn[] {
  return txns.map((t, index) => ({
    index,
    date: t.date,
    amount: roundMoney(Math.abs(t.amount)),
    currency: t.currency,
    time: t.time ?? null,
    merchant: t.merchant ?? null,
    raw: t.raw ?? null,
    isRefund: t.amount < 0,
  }));
}

// Fuzzy store-name comparison for statement reconciliation. The bank statement
// gives a `merchant`/`raw` string (e.g. "MCDONALDS 123 BERLIN", "LIDL SAGT DANKE")
// while the receipt carries a hand-/AI-entered `store` ("McDonald's", "Lidl").
// A name match upgrades a date+amount match to "confident enough to auto-correct
// paid_by"; a mismatch leaves it for the user to confirm. Deliberately
// conservative — false positives here silently flip the wrong receipt's payer.
//
// Learned aliases supplement the token match: when the user confirms a match
// whose names did NOT fuzzy-match, the normalized pair is persisted
// (store_aliases table) and passed back in as `aliasKeys` on later runs.

import type { StoreAliasInput } from './schemas';

// Lowercase, strip diacritics, drop everything but letters/digits/space, collapse
// runs of whitespace. "McDonald's" → "mcdonalds", "Café" → "cafe".
export function normalizeStoreName(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      // Drop punctuation rather than space it, so "McDonald's" → "mcdonalds"
      // (one token) instead of "mcdonald s". Whitespace is kept as the separator.
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// Tokens of length ≥3 — short tokens ("an", "de", store numbers) are too noisy to
// anchor a match on.
function significantTokens(normalized: string): string[] {
  return normalized.split(' ').filter((t) => t.length >= 3);
}

// Canonical lookup key for a learned alias pair. Normalization is idempotent,
// so both raw UI strings and already-normalized DB values are safe inputs.
export function makeStoreAliasKey(statementName: string, receiptStore: string): string {
  return `${normalizeStoreName(statementName)}|${normalizeStoreName(receiptStore)}`;
}

/**
 * True when the statement's merchant/raw text and the receipt's store name share
 * a significant (≥3-char) token, or when the normalized pair is a learned alias.
 * Checks both `merchant` and `raw` against the store; either hitting is enough
 * (statements vary on which field carries the recognizable name). Returns false
 * when there's nothing to compare.
 */
export function storeNamesMatch(
  merchant: string | null,
  raw: string | null,
  receiptStore: string,
  aliasKeys?: ReadonlySet<string>,
): boolean {
  const storeNorm = normalizeStoreName(receiptStore);
  const storeTokens = significantTokens(storeNorm);

  for (const candidate of [merchant, raw]) {
    if (candidate == null) continue;
    const candNorm = normalizeStoreName(candidate);
    if (candNorm.length === 0) continue;
    // Alias check first — it must work even when the store name has no
    // significant token (e.g. "H&M" → "hm"), where the token match can't fire.
    if (aliasKeys?.has(`${candNorm}|${storeNorm}`)) return true;
    if (storeTokens.length === 0) continue;
    const candTokens = new Set(significantTokens(candNorm));
    if (candTokens.size === 0) continue;
    if (storeTokens.some((t) => candTokens.has(t))) return true;
  }
  return false;
}

// Alias rows to persist when the user confirms a name-mismatch match: one per
// distinct non-empty statement field (merchant and raw both participate in
// matching, so both are worth remembering). Pre-normalized only for dedup here;
// makeStoreAlias normalizes again before writing.
export function storeAliasInputsFromMatch(
  merchant: string | null,
  raw: string | null,
  receiptStore: string,
): StoreAliasInput[] {
  const store = normalizeStoreName(receiptStore);
  if (store.length === 0) return [];
  const names = new Set<string>();
  for (const candidate of [merchant, raw]) {
    if (candidate == null) continue;
    const norm = normalizeStoreName(candidate);
    if (norm.length > 0) names.add(norm);
  }
  return [...names].map((statement_name) => ({ statement_name, receipt_store: store }));
}

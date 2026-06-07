// Fuzzy store-name comparison for statement reconciliation. The bank statement
// gives a `merchant`/`raw` string (e.g. "MCDONALDS 123 BERLIN", "LIDL SAGT DANKE")
// while the receipt carries a hand-/AI-entered `store` ("McDonald's", "Lidl").
// A name match upgrades a date+amount match to "confident enough to auto-correct
// paid_by"; a mismatch leaves it for the user to confirm. Deliberately
// conservative — false positives here silently flip the wrong receipt's payer.

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

/**
 * True when the statement's merchant/raw text and the receipt's store name share
 * a significant (≥3-char) token. Checks both `merchant` and `raw` against the
 * store; either hitting is enough (statements vary on which field carries the
 * recognizable name). Returns false when there's nothing to compare.
 */
export function storeNamesMatch(
  merchant: string | null,
  raw: string | null,
  receiptStore: string,
): boolean {
  const storeTokens = significantTokens(normalizeStoreName(receiptStore));
  if (storeTokens.length === 0) return false;

  for (const candidate of [merchant, raw]) {
    if (candidate == null) continue;
    const candTokens = new Set(significantTokens(normalizeStoreName(candidate)));
    if (candTokens.size === 0) continue;
    if (storeTokens.some((t) => candTokens.has(t))) return true;
  }
  return false;
}

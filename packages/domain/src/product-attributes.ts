// «Інше» on a packaged product card (ADR-0035): free-form label facts that have no
// column of their own. Vendor-free: only the limits and the pure functions that the
// schemas, the import review, the merge-on-reuse path, the catalogue search and the
// detail page all share.

/** Mirrors the key length check in public.is_valid_packaged_product_attributes. */
export const ATTRIBUTE_KEY_MAX_LENGTH = 60;

/** Mirrors the value length check in public.is_valid_packaged_product_attributes. */
export const ATTRIBUTE_VALUE_MAX_LENGTH = 300;

/** Pairs one import JSON may carry for a single product. */
export const IMPORT_ATTRIBUTES_MAX = 15;

/**
 * Pairs one card may hold. Deliberately above the per-import limit: merging
 * repeated imports into a reused card must never have to drop a pair.
 * Mirrors public.is_valid_packaged_product_attributes.
 */
export const CARD_ATTRIBUTES_MAX = 30;

export type ProductAttributes = Record<string, string>;

/**
 * Identity of a key: case- and whitespace-insensitive, so "Країна  походження" and
 * "країна походження" are the same pair. The stored key keeps its original wording.
 */
export function attributeKeyIdentity(key: string): string {
  return key.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Why a pair cannot be stored, or null when it can. Mirrors the per-pair rules of
 * public.is_valid_packaged_product_attributes, so a violation surfaces as a
 * readable issue before the round-trip to Postgres.
 */
export function attributePairProblem(key: string, value: string): string | null {
  if (key !== key.trim() || key.length < 1 || key.length > ATTRIBUTE_KEY_MAX_LENGTH) {
    return `Key must be a trimmed text of 1..${String(ATTRIBUTE_KEY_MAX_LENGTH)} characters`;
  }
  if (value !== value.trim() || value.length < 1 || value.length > ATTRIBUTE_VALUE_MAX_LENGTH) {
    return `Value must be a trimmed text of 1..${String(ATTRIBUTE_VALUE_MAX_LENGTH)} characters`;
  }
  return null;
}

function isTextual(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * Trims keys and values, drops pairs with a blank key or value (nothing was
 * printed) and case/whitespace-insensitive duplicate keys. Keeps the first-seen
 * pair and the original wording of the surviving key. A number is written as its
 * text; any other value type carries no usable text and is dropped.
 */
export function normalizeAttributes(
  attributes: Readonly<Record<string, unknown>> | null | undefined,
): ProductAttributes {
  const seen = new Set<string>();
  const result: ProductAttributes = {};
  for (const [rawKey, rawValue] of Object.entries(attributes ?? {})) {
    if (!isTextual(rawValue)) continue;
    const key = rawKey.trim();
    const value = String(rawValue).trim();
    const identity = attributeKeyIdentity(key);
    if (identity === '' || value === '' || seen.has(identity)) continue;
    seen.add(identity);
    result[key] = value;
  }
  return result;
}

/**
 * The existing pairs first, untouched, then the incoming pairs whose key is not
 * already there (ignoring case and spacing). A value already on the card is the
 * owner's edit or an earlier import and is never replaced. Never removes a pair;
 * the caller decides what to do if the result exceeds CARD_ATTRIBUTES_MAX.
 */
export function mergeAttributes(
  existing: Readonly<Record<string, string>> | null | undefined,
  incoming: Readonly<Record<string, string>> | null | undefined,
): ProductAttributes {
  const result: ProductAttributes = { ...existing };
  const taken = new Set(Object.keys(result).map(attributeKeyIdentity));
  for (const [key, value] of Object.entries(normalizeAttributes(incoming))) {
    const identity = attributeKeyIdentity(key);
    if (taken.has(identity)) continue;
    taken.add(identity);
    result[key] = value;
  }
  return result;
}

/** Same keys with the same values; the order of the pairs does not matter (jsonb loses it). */
export function sameAttributes(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const aKeys = Object.keys(a);
  return aKeys.length === Object.keys(b).length && aKeys.every((key) => a[key] === b[key]);
}

/**
 * What a jsonb column returned, as attributes. The database CHECK keeps the column
 * clean, so this only guards against a hand-edited row or an older schema: anything
 * that is not a string pair is skipped rather than failing the card page.
 */
export function attributesFromJson(value: unknown): ProductAttributes {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: ProductAttributes = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') result[key] = entry;
  }
  return result;
}

const UK_COLLATOR = new Intl.Collator('uk', { sensitivity: 'base' });

/**
 * Pairs in a stable display order. jsonb returns keys by length and bytes, which
 * reads as random, so the UI sorts them alphabetically instead.
 */
export function attributeEntries(
  attributes: Readonly<Record<string, string>>,
): [key: string, value: string][] {
  return Object.entries(attributes).sort(([a], [b]) => UK_COLLATOR.compare(a, b));
}

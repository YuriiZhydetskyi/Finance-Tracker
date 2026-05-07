// Parses the `consumed_by` field on Items. Allowed shapes:
//   'his' | 'hers' | 'shared' | 'custom:N/M' (where N + M = 100, both ≥ 0).
// See data-model.md §Items.consumed_by.

export const CONSUMED_BY_REGEX = /^(?:his|hers|shared|custom:\d+\/\d+)$/;

export type ParsedConsumedBy =
  | { type: 'his' }
  | { type: 'hers' }
  | { type: 'shared' }
  | { type: 'custom'; hisShare: number; hersShare: number };

const CUSTOM_RE = /^custom:(\d+)\/(\d+)$/;

export function parseConsumedBy(value: string): ParsedConsumedBy {
  if (value === 'his' || value === 'hers' || value === 'shared') {
    return { type: value };
  }
  const match = CUSTOM_RE.exec(value);
  if (match) {
    const hisShare = Number.parseInt(match[1] ?? '', 10);
    const hersShare = Number.parseInt(match[2] ?? '', 10);
    if (hisShare + hersShare !== 100) {
      throw new Error(
        `Invalid consumed_by "${value}": shares must sum to 100, got ${String(hisShare + hersShare)}`,
      );
    }
    return { type: 'custom', hisShare, hersShare };
  }
  throw new Error(
    `Invalid consumed_by syntax: "${value}". Expected: his | hers | shared | custom:N/M (N+M=100)`,
  );
}

export function isValidConsumedBy(value: string): boolean {
  if (!CONSUMED_BY_REGEX.test(value)) return false;
  try {
    parseConsumedBy(value);
    return true;
  } catch {
    return false;
  }
}

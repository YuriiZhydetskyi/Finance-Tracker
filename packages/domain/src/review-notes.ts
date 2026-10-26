// "Needs manual check" notes on a packaged product card (ADR-0030).
// Vendor-free: only the limits and the pure functions that the schemas, the
// import review, the merge-on-reuse path and the detail page all share.

/** Mirrors the per-note length check in public.is_valid_review_notes. */
export const REVIEW_NOTE_MAX_LENGTH = 300;

/** Notes one import JSON may carry for a single product. */
export const IMPORT_REVIEW_NOTES_MAX = 10;

/**
 * Notes one card may hold. Deliberately above the per-import limit: merging
 * repeated imports into a reused card must never have to drop a note.
 * Mirrors public.is_valid_review_notes.
 */
export const CARD_REVIEW_NOTES_MAX = 50;

function noteKey(note: string): string {
  return note.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Trims, drops blanks and case/whitespace-insensitive duplicates. Keeps the
 * first-seen order and the original wording of the surviving note.
 */
export function normalizeReviewNotes(notes: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of notes ?? []) {
    const note = raw.trim();
    const key = noteKey(note);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(note);
  }
  return result;
}

/**
 * Existing notes first, then the incoming ones that are not already there.
 * Never removes a note that was not a duplicate; the caller decides what to do
 * if the result exceeds CARD_REVIEW_NOTES_MAX.
 */
export function mergeReviewNotes(
  existing: readonly string[] | null | undefined,
  incoming: readonly string[] | null | undefined,
): string[] {
  return normalizeReviewNotes([...(existing ?? []), ...(incoming ?? [])]);
}

export function sameReviewNotes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((note, index) => note === b[index]);
}

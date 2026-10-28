// Helpers for the receipt that rides along with a JSON + PDF packaging import.
// The receipt itself is read by the durable import queue (ADR-0016); this file only
// names it, and compares what the transcriber saw with what is already stored.

/** «сторінки 3» / «сторінок 1, 2». */
export function receiptPagesLabel(pages: number[]): string {
  return `${pages.length === 1 ? 'сторінки' : 'сторінок'} ${pages.join(', ')}`;
}

/** The name the receipt PDF gets in the import queue: the source file, then what was cut from it. */
export function receiptImportFileName(sourceFileName: string, pages: number[]): string {
  const base = sourceFileName.replace(/\.pdf$/i, '').trim() || 'чек';
  return `${base} — чек, стор. ${pages.join(', ')}.pdf`;
}

function comparableStoreName(store: string): string {
  return store
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Loose store comparison for a warning, not for linking anything: the transcriber
 * writes «REWE» where the stored receipt says «REWE Ahmad-Shah Hessami oHG», and
 * «ALDI SÜD» and «Aldi Süd» are the same shop. Equal after dropping case, accents and
 * punctuation, or one name starts with the other (3+ characters, so «Lidl» never
 * matches by a stray letter).
 */
export function storesLookAlike(a: string, b: string): boolean {
  const left = comparableStoreName(a);
  const right = comparableStoreName(b);
  if (left.length < 3 || right.length < 3) return left === right && left.length > 0;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

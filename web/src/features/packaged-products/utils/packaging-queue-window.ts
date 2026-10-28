// The «Без картки» queue shows only recently bought rows by default: an old, rare
// purchase would otherwise fill the list with things nobody can photograph any more.

export const PACKAGING_QUEUE_WINDOW_DAYS = 30;

/**
 * What the queue is showing:
 * - `search`: a text query is typed — every row is searched, wherever its last purchase falls;
 * - `all`: «Показати всі» is on;
 * - `recent`: the default, rows last bought within the window.
 */
export type PackagingQueueScope = 'search' | 'all' | 'recent';

export function packagingQueueScope(query: string, showAll: boolean): PackagingQueueScope {
  if (query.trim() !== '') return 'search';
  return showAll ? 'all' : 'recent';
}

/** The local calendar date `days` before `now` (inclusive start of the window), as YYYY-MM-DD. */
export function packagingQueueWindowStart(
  now: Date = new Date(),
  days: number = PACKAGING_QUEUE_WINDOW_DAYS,
): string {
  // Built from calendar parts, not from milliseconds, so a DST change never moves the day.
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const month = String(start.getMonth() + 1).padStart(2, '0');
  const day = String(start.getDate()).padStart(2, '0');
  return `${String(start.getFullYear())}-${month}-${day}`;
}

/** The `p_last_purchased_since` for the rows to list, or `undefined` to list every row. */
export function packagingQueueRowsSince(
  scope: PackagingQueueScope,
  windowStart: string,
): string | undefined {
  return scope === 'recent' ? windowStart : undefined;
}

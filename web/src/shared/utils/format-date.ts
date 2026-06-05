// Display formatter for ISO date strings (YYYY-MM-DD). Domain stores dates
// as plain ISO strings to dodge timezone drift; this is purely for UI display.

import { isoToUtcDate } from '@finance-tracker/domain';

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getFormatter(locale: string): Intl.DateTimeFormat {
  let fmt = FORMATTER_CACHE.get(locale);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' });
    FORMATTER_CACHE.set(locale, fmt);
  }
  return fmt;
}

/**
 * Format an ISO date string (YYYY-MM-DD) for display.
 * Returns the original string if parsing fails (defensive — never throws).
 */
export function formatDate(iso: string, locale = 'uk-UA'): string {
  const date = isoToUtcDate(iso);
  if (!date) return iso;
  return getFormatter(locale).format(date);
}

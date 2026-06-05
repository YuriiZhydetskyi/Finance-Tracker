// Time helpers. Domain stores ISO 8601 instants in UTC (`Z`-suffixed).
// Display layer is responsible for converting to the user's timezone.
// `todayIso` returns YYYY-MM-DD in the configured timezone (default Europe/Berlin)
// — used as the default `date` field in new receipts.

export const DEFAULT_TIMEZONE = 'Europe/Berlin';

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

// ── Date-only (YYYY-MM-DD) arithmetic ──────────────────────────────────────
// Plain calendar-day math in UTC, independent of timezone. Shared by the
// reconcile matcher (date-gap scoring), the statement fetch window, and the
// web date-display formatter.

/** Parse a YYYY-MM-DD string to a UTC midnight Date, or null if unparseable. */
export function isoToUtcDate(iso: string): Date | null {
  const parts = iso.split('-');
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoToEpochDay(iso: string): number {
  const date = isoToUtcDate(iso);
  return date ? Math.floor(date.getTime() / 86_400_000) : NaN;
}

/** Absolute number of calendar days between two YYYY-MM-DD dates. */
export function daysBetweenIso(a: string, b: string): number {
  return Math.abs(isoToEpochDay(a) - isoToEpochDay(b));
}

/** Shift a YYYY-MM-DD date by `days` (may be negative); returns YYYY-MM-DD. */
export function addDaysIso(iso: string, days: number): string {
  const date = new Date(isoToEpochDay(iso) * 86_400_000);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

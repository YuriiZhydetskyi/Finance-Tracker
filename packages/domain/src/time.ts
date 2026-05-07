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

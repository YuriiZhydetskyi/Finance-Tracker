import { z } from 'zod';
import type { WasteFilters } from './api/use-waste-items';

// URL search params for /waste. Mirror of recent-search.ts but with the
// per-item axes the Waste page needs (item-level category, name search,
// "show fully wasted" toggle). All fields optional — a bare /waste URL
// uses the defaults (last 60 days, hide fully-wasted).

export const WasteSearchSchema = z
  .object({
    q: z.string().optional(), // item name ILIKE
    category: z.string().optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    store: z.string().optional(),
    min: z.coerce.number().nonnegative().optional(),
    max: z.coerce.number().nonnegative().optional(),
    // When true, fully-wasted items stay in the list. Default is to hide
    // them — once an item is fully accounted for, it's just visual noise.
    showAll: z.coerce.boolean().optional(),
  })
  .optional();

export type WasteSearchParams = z.infer<typeof WasteSearchSchema>;
export type WasteSearchInput = NonNullable<WasteSearchParams>;

export const DEFAULT_DATE_WINDOW_DAYS = 60;

/**
 * Default "from" date: today minus DEFAULT_DATE_WINDOW_DAYS, in YYYY-MM-DD.
 * The Waste page leans heavily on recent items — staring at June groceries in
 * December isn't useful, so we hide the long tail by default. User can clear
 * the filter to see everything.
 */
export function defaultDateFrom(today: Date = new Date()): string {
  const d = new Date(today);
  d.setDate(d.getDate() - DEFAULT_DATE_WINDOW_DAYS);
  // YYYY-MM-DD via en-CA locale (same trick as todayIso in @finance-tracker/domain).
  return new Intl.DateTimeFormat('en-CA').format(d);
}

/**
 * Project URL search params into the filter shape useWasteItems accepts.
 * Only-defined keys to satisfy exactOptionalPropertyTypes.
 */
export function searchToWasteFilters(search: WasteSearchInput | undefined): WasteFilters {
  const f: WasteFilters = {
    // Default windowing applies when 'from' is unset; an explicit empty 'from'
    // (cleared via filter bar UI by deleting the value) becomes undefined here,
    // i.e. user opted out of the window — show everything.
    dateFrom: search?.from ?? defaultDateFrom(),
    showFullyWasted: search?.showAll ?? false,
  };
  if (search?.q) f.nameSearch = search.q;
  if (search?.category) f.category = search.category;
  if (search?.to) f.dateTo = search.to;
  if (search?.store) f.storeSearch = search.store;
  if (search?.min != null) f.priceMin = search.min;
  if (search?.max != null) f.priceMax = search.max;
  return f;
}

/** Count of "non-default" filters — drives the "Активні: N" hint. */
export function countActiveWasteFilters(search: WasteSearchInput | undefined): number {
  if (!search) return 0;
  return [
    search.q,
    search.category,
    search.from,
    search.to,
    search.store,
    search.min,
    search.max,
    search.showAll,
  ].filter((v) => v != null && v !== '' && v !== false).length;
}

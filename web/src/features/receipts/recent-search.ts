import { z } from 'zod';
import type { ReceiptFilters } from './api/use-receipts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// URL search params for the /recent page. Shared between the route's
// `validateSearch` and the filter bar component so the shape is single-source.
// All fields optional — a bare /recent URL means "show everything". A malformed
// value from a hand-edited URL is dropped instead of failing the whole route.
export const RecentSearchSchema = z.object({
  saved: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  paid_by: z.string().optional().catch(undefined),
  min: z.coerce.number().nonnegative().optional().catch(undefined),
  max: z.coerce.number().nonnegative().optional().catch(undefined),
});

export type RecentSearchParams = z.infer<typeof RecentSearchSchema>;
export type RecentSearchInput = RecentSearchParams;

/**
 * Project URL search params into the filter shape useReceipts accepts.
 * Builds with only-defined keys to satisfy exactOptionalPropertyTypes — a
 * present key whose value is `undefined` is not the same as a missing key.
 */
export function searchToFilters(search: RecentSearchInput): ReceiptFilters {
  const f: ReceiptFilters = {};
  if (search.q) f.store = search.q;
  if (search.from) f.dateFrom = search.from;
  if (search.to) f.dateTo = search.to;
  if (search.paid_by) f.paidBy = search.paid_by;
  if (search.min != null) f.amountMin = search.min;
  if (search.max != null) f.amountMax = search.max;
  return f;
}

/** How many filter fields the user has populated. Drives the "Активні: N" hint. */
export function countActiveFilters(filters: ReceiptFilters): number {
  return [
    filters.store,
    filters.dateFrom,
    filters.dateTo,
    filters.paidBy,
    filters.amountMin,
    filters.amountMax,
  ].filter((v) => v != null && v !== '').length;
}

// The photographing queue. Backed by a security-invoker SQL function because the
// ranking needs a COUNT over items joined to receipts, which PostgREST cannot
// express; the caller's RLS still applies to every table it touches.

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import {
  packagedProductStoreLabelsQueryKey,
  packagingCandidatesQueryKey,
} from './packaged-products-query-keys';
import type { PackagedProductStoreLabelRow, PackagingCandidateRow } from '../types';

const ONE_MIN = 60_000;
const DEFAULT_LIMIT = 200;

// PostgREST returns `numeric` from a `returns table` function as a JSON string.
function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  return asNumber(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function toCandidate(row: Record<string, unknown>): PackagingCandidateRow {
  return {
    product_id: asString(row.product_id),
    product_name: asString(row.product_name),
    store: asString(row.store),
    store_product_code: asNullableString(row.store_product_code),
    category: asString(row.category),
    brand: asNullableString(row.brand),
    is_organic: typeof row.is_organic === 'boolean' ? row.is_organic : null,
    product_family_id: asNullableString(row.product_family_id),
    product_variant_id: asNullableString(row.product_variant_id),
    receipt_labels: asStringArray(row.receipt_labels),
    purchases_count: asNumber(row.purchases_count),
    total_qty: asNumber(row.total_qty),
    total_eur: asNumber(row.total_eur),
    last_purchased_on: asNullableString(row.last_purchased_on),
    last_price_orig: asNullableNumber(row.last_price_orig),
    last_currency: asNullableString(row.last_currency),
    group_key: asString(row.group_key),
    group_purchases_count: asNumber(row.group_purchases_count),
    other_store_purchases_count: asNumber(row.other_store_purchases_count),
  };
}

export type PackagingCandidateFilters = {
  query?: string;
  categories?: string[];
  stores?: string[];
  /** YYYY-MM-DD; keep only rows last bought on or after it. Absent lists every row. */
  lastPurchasedSince?: string | undefined;
  limit?: number;
};

export function packagingCandidatesQueryOptions(filters: PackagingCandidateFilters = {}) {
  const { query = '', categories, stores, lastPurchasedSince, limit = DEFAULT_LIMIT } = filters;

  return queryOptions({
    queryKey: [
      ...packagingCandidatesQueryKey,
      query,
      categories ?? null,
      stores ?? null,
      lastPurchasedSince ?? null,
      limit,
    ],
    staleTime: ONE_MIN,
    queryFn: async ({ signal }): Promise<PackagingCandidateRow[]> => {
      const { data, error } = await supabase
        .rpc('search_packaging_candidates', {
          p_query: query,
          p_limit: limit,
          // exactOptionalPropertyTypes: an absent filter must be an absent key,
          // never an explicit undefined.
          ...(categories && categories.length > 0 ? { p_categories: categories } : {}),
          ...(stores && stores.length > 0 ? { p_stores: stores } : {}),
          ...(lastPurchasedSince ? { p_last_purchased_since: lastPurchasedSince } : {}),
        })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []).map((row) => toCandidate(row as Record<string, unknown>));
    },
  });
}

export function usePackagingCandidates(filters: PackagingCandidateFilters = {}) {
  return useQuery({
    ...packagingCandidatesQueryOptions(filters),
    placeholderData: keepPreviousData,
  });
}

export function packagedProductStoreLabelsQueryOptions(id: string) {
  return queryOptions({
    queryKey: packagedProductStoreLabelsQueryKey(id),
    queryFn: async ({ signal }): Promise<PackagedProductStoreLabelRow[]> => {
      const { data, error } = await supabase
        .rpc('packaged_product_store_labels', { p_packaged_product_id: id })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []).map((raw) => {
        const row = raw as Record<string, unknown>;
        return {
          product_id: asString(row.product_id),
          store: asString(row.store),
          product_name: asString(row.product_name),
          store_product_code: asNullableString(row.store_product_code),
          receipt_labels: asStringArray(row.receipt_labels),
          purchases_count: asNumber(row.purchases_count),
          first_purchased_on: asNullableString(row.first_purchased_on),
          last_purchased_on: asNullableString(row.last_purchased_on),
          last_price_orig: asNullableNumber(row.last_price_orig),
          last_price_net: asNullableNumber(row.last_price_net),
          last_currency: asNullableString(row.last_currency),
        };
      });
    },
  });
}

/** "Printed as X at REWE and Y at Aldi", with purchase counts and the latest price. */
export function usePackagedProductStoreLabels(id: string) {
  return useQuery(packagedProductStoreLabelsQueryOptions(id));
}

export type PackagingQueueSummary = {
  /** Every queue row matching the query. */
  total_count: number;
  /** Those last bought on or after `lastPurchasedSince` (all of them when it is absent). */
  recent_count: number;
};

export function packagingQueueSummaryQueryOptions(
  filters: { query?: string; lastPurchasedSince?: string | undefined } = {},
) {
  const { query = '', lastPurchasedSince } = filters;

  return queryOptions({
    queryKey: [...packagingCandidatesQueryKey, 'summary', query, lastPurchasedSince ?? null],
    staleTime: ONE_MIN,
    queryFn: async ({ signal }): Promise<PackagingQueueSummary> => {
      const { data, error } = await supabase
        .rpc('packaging_queue_summary', {
          p_query: query,
          ...(lastPurchasedSince ? { p_last_purchased_since: lastPurchasedSince } : {}),
        })
        .abortSignal(signal);
      if (error) throw error;
      const row = (data?.[0] ?? {}) as Record<string, unknown>;
      return { total_count: asNumber(row.total_count), recent_count: asNumber(row.recent_count) };
    },
  });
}

/** How many queue rows there are, and how many of them fall inside the recency window. */
export function usePackagingQueueSummary(
  filters: { query?: string; lastPurchasedSince?: string | undefined } = {},
) {
  return useQuery({
    ...packagingQueueSummaryQueryOptions(filters),
    placeholderData: keepPreviousData,
  });
}

/**
 * The home-page badge: queue rows bought within the window, i.e. exactly what the
 * queue opens with. The same cached summary as the queue tab, so one RPC serves both.
 */
export function usePackagingCandidatesCount(windowStart: string) {
  return useQuery({
    ...packagingQueueSummaryQueryOptions({ lastPurchasedSince: windowStart }),
    select: (summary) => summary.recent_count,
  });
}

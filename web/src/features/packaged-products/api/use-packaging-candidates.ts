// The photographing queue. Backed by a security-invoker SQL function because the
// ranking needs a COUNT over items joined to receipts, which PostgREST cannot
// express; the caller's RLS still applies to every table it touches.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import {
  packagedProductStoreLabelsQueryKey,
  packagingCandidatesCountQueryKey,
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
  };
}

export type PackagingCandidateFilters = {
  query?: string;
  categories?: string[];
  stores?: string[];
  limit?: number;
};

export function usePackagingCandidates(filters: PackagingCandidateFilters = {}) {
  const { query = '', categories, stores, limit = DEFAULT_LIMIT } = filters;

  return useQuery<PackagingCandidateRow[]>({
    queryKey: [...packagingCandidatesQueryKey, query, categories ?? null, stores ?? null, limit],
    staleTime: ONE_MIN,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_packaging_candidates', {
        p_query: query,
        p_limit: limit,
        // exactOptionalPropertyTypes: an absent filter must be an absent key,
        // never an explicit undefined.
        ...(categories && categories.length > 0 ? { p_categories: categories } : {}),
        ...(stores && stores.length > 0 ? { p_stores: stores } : {}),
      });
      if (error) throw error;
      return (data ?? []).map((row) => toCandidate(row as Record<string, unknown>));
    },
  });
}

/** "Printed as X at REWE and Y at Aldi", with purchase counts and the latest price. */
export function usePackagedProductStoreLabels(id: string) {
  return useQuery<PackagedProductStoreLabelRow[]>({
    queryKey: packagedProductStoreLabelsQueryKey(id),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('packaged_product_store_labels', {
        p_packaged_product_id: id,
      });
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

/**
 * Just the size of the queue, for the home-page badge. A HEAD count instead of
 * the ranking RPC so opening the home page never pays for the aggregate.
 */
export function usePackagingCandidatesCount() {
  return useQuery<number>({
    queryKey: packagingCandidatesCountQueryKey,
    staleTime: ONE_MIN,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .is('packaged_product_id', null)
        .eq('packaging_not_applicable', false);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

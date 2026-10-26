// Stats queries call date-aware database functions. They use security invoker,
// so the caller's RLS policies still apply to receipts and items.

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import type {
  StatsByCategoryRow,
  StatsByMonthRow,
  StatsByStoreRow,
  StatsByUserRow,
  StatsDateRange,
  StatsFilterOptions,
  StatsFilters,
  StatsSavingsByMonthRow,
  StatsWasteByMonthRow,
} from './stats.types';

const FIVE_MIN = 5 * 60_000;

export const statsQueryKey = ['stats'] as const;
export const statsByMonthQueryKey = [...statsQueryKey, 'by-month'] as const;
export const statsByCategoryQueryKey = [...statsQueryKey, 'by-category'] as const;
export const statsByUserQueryKey = [...statsQueryKey, 'by-user'] as const;
export const statsByStoreQueryKey = [...statsQueryKey, 'by-store'] as const;
export const statsSavingsByMonthQueryKey = [...statsQueryKey, 'savings-by-month'] as const;
export const wasteByMonthQueryKey = [...statsQueryKey, 'waste-by-month'] as const;
export const statsFilterOptionsQueryKey = [...statsQueryKey, 'filter-options'] as const;
export const statsCategoryDetailsQueryKey = [...statsQueryKey, 'category-details'] as const;

type RawNumericRow = Record<string, unknown>;

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }
  return 0;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toRpcArgs(range: StatsDateRange, filters: StatsFilters) {
  return {
    ...(range.dateFrom ? { p_date_from: range.dateFrom } : {}),
    ...(range.dateTo ? { p_date_to: range.dateTo } : {}),
    ...(filters.categories ? { p_categories: filters.categories } : {}),
    ...(filters.stores ? { p_stores: filters.stores } : {}),
  };
}

export function statsByMonthQueryOptions(range: StatsDateRange, filters: StatsFilters) {
  return queryOptions({
    queryKey: [...statsByMonthQueryKey, range, filters],
    queryFn: async ({ signal }): Promise<StatsByMonthRow[]> => {
      const { data, error } = await supabase
        .rpc('stats_by_month', toRpcArgs(range, filters))
        .abortSignal(signal);
      if (error) throw error;
      return (data as RawNumericRow[]).map((row) => ({
        month: asString(row.month),
        total_eur: asNumber(row.total_eur),
        receipts_count: asNumber(row.receipts_count),
      }));
    },
    staleTime: FIVE_MIN,
  });
}

export function statsByCategoryQueryOptions(range: StatsDateRange, filters: StatsFilters) {
  return queryOptions({
    queryKey: [...statsByCategoryQueryKey, range, filters],
    queryFn: async ({ signal }): Promise<StatsByCategoryRow[]> => {
      const { data, error } = await supabase
        .rpc('stats_by_category', toRpcArgs(range, filters))
        .abortSignal(signal);
      if (error) throw error;
      return (data as RawNumericRow[]).map((row) => ({
        category: asString(row.category),
        total_eur: asNumber(row.total_eur),
        items_count: asNumber(row.items_count),
      }));
    },
    staleTime: FIVE_MIN,
  });
}

export function statsByUserQueryOptions(range: StatsDateRange, filters: StatsFilters) {
  return queryOptions({
    queryKey: [...statsByUserQueryKey, range, filters],
    queryFn: async ({ signal }): Promise<StatsByUserRow[]> => {
      const { data, error } = await supabase
        .rpc('stats_by_user', toRpcArgs(range, filters))
        .abortSignal(signal);
      if (error) throw error;
      return (data as RawNumericRow[]).map((row) => ({
        paid_by: asString(row.paid_by),
        total_eur: asNumber(row.total_eur),
        receipts_count: asNumber(row.receipts_count),
      }));
    },
    staleTime: FIVE_MIN,
  });
}

export function statsSavingsByMonthQueryOptions(range: StatsDateRange, filters: StatsFilters) {
  return queryOptions({
    queryKey: [...statsSavingsByMonthQueryKey, range, filters],
    queryFn: async ({ signal }): Promise<StatsSavingsByMonthRow[]> => {
      const { data, error } = await supabase
        .rpc('stats_savings_by_month', toRpcArgs(range, filters))
        .abortSignal(signal);
      if (error) throw error;
      return (data as RawNumericRow[]).map((row) => ({
        month: asString(row.month),
        savings_eur: asNumber(row.savings_eur),
        discounted_items_count: asNumber(row.discounted_items_count),
      }));
    },
    staleTime: FIVE_MIN,
  });
}

export function statsWasteByMonthQueryOptions(range: StatsDateRange, filters: StatsFilters) {
  return queryOptions({
    queryKey: [...wasteByMonthQueryKey, range, filters],
    queryFn: async ({ signal }): Promise<StatsWasteByMonthRow[]> => {
      const { data, error } = await supabase
        .rpc('stats_waste_by_month', toRpcArgs(range, filters))
        .abortSignal(signal);
      if (error) throw error;
      return (data as RawNumericRow[]).map((row) => ({
        month: asString(row.month),
        wasted_value_eur: asNumber(row.wasted_value_eur),
        wasted_items_count: asNumber(row.wasted_items_count),
      }));
    },
    staleTime: FIVE_MIN,
  });
}

export function statsByStoreQueryOptions(range: StatsDateRange, filters: StatsFilters, limit = 10) {
  return queryOptions({
    queryKey: [...statsByStoreQueryKey, range, filters, limit],
    queryFn: async ({ signal }): Promise<StatsByStoreRow[]> => {
      const { data, error } = await supabase
        .rpc('stats_by_store', { ...toRpcArgs(range, filters), p_limit: limit })
        .abortSignal(signal);
      if (error) throw error;
      return (data as RawNumericRow[]).map((row) => ({
        store: asString(row.store),
        total_eur: asNumber(row.total_eur),
        receipts_count: asNumber(row.receipts_count),
      }));
    },
    staleTime: FIVE_MIN,
  });
}

export const statsFilterOptionsQueryOptions = queryOptions({
  queryKey: statsFilterOptionsQueryKey,
  queryFn: async ({ signal }): Promise<StatsFilterOptions> => {
    const { data, error } = await supabase.rpc('stats_filter_options').abortSignal(signal);
    if (error) throw error;
    const row = (data as RawNumericRow[])[0];
    return {
      categories: Array.isArray(row?.categories)
        ? row.categories.filter((value): value is string => typeof value === 'string')
        : [],
      stores: Array.isArray(row?.stores)
        ? row.stores.filter((value): value is string => typeof value === 'string')
        : [],
    };
  },
  staleTime: FIVE_MIN,
});

type StatsQueryOptions = { enabled?: boolean };

export function useStatsByMonth(
  range: StatsDateRange,
  filters: StatsFilters,
  options?: StatsQueryOptions,
) {
  return useQuery({
    ...statsByMonthQueryOptions(range, filters),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

export function useStatsByCategory(
  range: StatsDateRange,
  filters: StatsFilters,
  options?: StatsQueryOptions,
) {
  return useQuery({
    ...statsByCategoryQueryOptions(range, filters),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

export function useStatsByUser(
  range: StatsDateRange,
  filters: StatsFilters,
  options?: StatsQueryOptions,
) {
  return useQuery({
    ...statsByUserQueryOptions(range, filters),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

export function useStatsSavingsByMonth(
  range: StatsDateRange,
  filters: StatsFilters,
  options?: StatsQueryOptions,
) {
  return useQuery({
    ...statsSavingsByMonthQueryOptions(range, filters),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

export function useStatsWasteByMonth(
  range: StatsDateRange,
  filters: StatsFilters,
  options?: StatsQueryOptions,
) {
  return useQuery({
    ...statsWasteByMonthQueryOptions(range, filters),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

export function useStatsByStore(
  range: StatsDateRange,
  filters: StatsFilters,
  limit = 10,
  options?: StatsQueryOptions,
) {
  return useQuery({
    ...statsByStoreQueryOptions(range, filters, limit),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
  });
}

export function useStatsFilterOptions() {
  return useQuery(statsFilterOptionsQueryOptions);
}

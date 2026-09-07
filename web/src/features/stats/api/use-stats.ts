// Stats queries call date-aware database functions. They use security invoker,
// so the caller's RLS policies still apply to receipts and items.

import { useQuery } from '@tanstack/react-query';
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

export const statsByMonthQueryKey = ['stats', 'by-month'] as const;
export const statsByCategoryQueryKey = ['stats', 'by-category'] as const;
export const statsByUserQueryKey = ['stats', 'by-user'] as const;
export const statsByStoreQueryKey = ['stats', 'by-store'] as const;
export const statsSavingsByMonthQueryKey = ['stats', 'savings-by-month'] as const;
export const wasteByMonthQueryKey = ['stats', 'waste-by-month'] as const;
export const statsFilterOptionsQueryKey = ['stats', 'filter-options'] as const;

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

export function useStatsByMonth(
  range: StatsDateRange,
  filters: StatsFilters,
  options?: { enabled?: boolean },
) {
  return useQuery<StatsByMonthRow[]>({
    queryKey: [...statsByMonthQueryKey, range, filters],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('stats_by_month', toRpcArgs(range, filters));
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

export function useStatsByCategory(
  range: StatsDateRange,
  filters: StatsFilters,
  options?: { enabled?: boolean },
) {
  return useQuery<StatsByCategoryRow[]>({
    queryKey: [...statsByCategoryQueryKey, range, filters],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('stats_by_category', toRpcArgs(range, filters));
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

export function useStatsByUser(
  range: StatsDateRange,
  filters: StatsFilters,
  options?: { enabled?: boolean },
) {
  return useQuery<StatsByUserRow[]>({
    queryKey: [...statsByUserQueryKey, range, filters],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('stats_by_user', toRpcArgs(range, filters));
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

export function useStatsSavingsByMonth(
  range: StatsDateRange,
  filters: StatsFilters,
  options?: { enabled?: boolean },
) {
  return useQuery<StatsSavingsByMonthRow[]>({
    queryKey: [...statsSavingsByMonthQueryKey, range, filters],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'stats_savings_by_month',
        toRpcArgs(range, filters),
      );
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

export function useStatsWasteByMonth(
  range: StatsDateRange,
  filters: StatsFilters,
  options?: { enabled?: boolean },
) {
  return useQuery<StatsWasteByMonthRow[]>({
    queryKey: [...wasteByMonthQueryKey, range, filters],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('stats_waste_by_month', toRpcArgs(range, filters));
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

export function useStatsByStore(
  range: StatsDateRange,
  filters: StatsFilters,
  limit = 10,
  options?: { enabled?: boolean },
) {
  return useQuery<StatsByStoreRow[]>({
    queryKey: [...statsByStoreQueryKey, { ...range, ...filters, limit }],
    enabled: options?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('stats_by_store', {
        ...toRpcArgs(range, filters),
        p_limit: limit,
      });
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

export function useStatsFilterOptions() {
  return useQuery<StatsFilterOptions>({
    queryKey: statsFilterOptionsQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('stats_filter_options');
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
}

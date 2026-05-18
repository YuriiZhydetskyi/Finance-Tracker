// Stats query hooks — one per chart. Each reads a Postgres view (v_stats_*)
// that does the GROUP BY server-side. RLS on the view inherits from the
// underlying tables via security_invoker, so allowlisted users see all data.
//
// staleTime: 5 minutes — stats don't change second-by-second, and a /stats
// page refresh shouldn't pay the round-trip if the user already loaded it.
//
// Numerics arrive over the wire as strings; coerced here.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/shared/lib/supabase-client';
import type {
  StatsByCategoryRow,
  StatsByMonthRow,
  StatsByStoreRow,
  StatsByUserRow,
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

type RawNumericRow = Record<string, unknown>;

function asNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function useStatsByMonth(limit = 12) {
  return useQuery<StatsByMonthRow[]>({
    queryKey: [...statsByMonthQueryKey, { limit }],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stats_by_month')
        .select('month, total_eur, receipts_count')
        .order('month', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data as RawNumericRow[]).map((r) => ({
        month: asString(r.month),
        total_eur: asNumber(r.total_eur),
        receipts_count: asNumber(r.receipts_count),
      }));
    },
    staleTime: FIVE_MIN,
  });
}

export function useStatsByCategory() {
  return useQuery<StatsByCategoryRow[]>({
    queryKey: statsByCategoryQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stats_by_category')
        .select('category, total_eur, items_count');
      if (error) throw error;
      return (data as RawNumericRow[]).map((r) => ({
        category: asString(r.category),
        total_eur: asNumber(r.total_eur),
        items_count: asNumber(r.items_count),
      }));
    },
    staleTime: FIVE_MIN,
  });
}

export function useStatsByUser() {
  return useQuery<StatsByUserRow[]>({
    queryKey: statsByUserQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stats_by_user')
        .select('paid_by, total_eur, receipts_count');
      if (error) throw error;
      return (data as RawNumericRow[]).map((r) => ({
        paid_by: asString(r.paid_by),
        total_eur: asNumber(r.total_eur),
        receipts_count: asNumber(r.receipts_count),
      }));
    },
    staleTime: FIVE_MIN,
  });
}

export function useStatsSavingsByMonth(limit = 12) {
  return useQuery<StatsSavingsByMonthRow[]>({
    queryKey: [...statsSavingsByMonthQueryKey, { limit }],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stats_savings_by_month')
        .select('month, savings_eur, discounted_items_count')
        .order('month', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data as RawNumericRow[]).map((r) => ({
        month: asString(r.month),
        savings_eur: asNumber(r.savings_eur),
        discounted_items_count: asNumber(r.discounted_items_count),
      }));
    },
    staleTime: FIVE_MIN,
  });
}

export function useStatsWasteByMonth(limit = 12) {
  return useQuery<StatsWasteByMonthRow[]>({
    queryKey: [...wasteByMonthQueryKey, { limit }],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stats_waste_by_month')
        .select('month, wasted_value_eur, wasted_items_count')
        .order('month', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data as RawNumericRow[]).map((r) => ({
        month: asString(r.month),
        wasted_value_eur: asNumber(r.wasted_value_eur),
        wasted_items_count: asNumber(r.wasted_items_count),
      }));
    },
    staleTime: FIVE_MIN,
  });
}

export function useStatsByStore(limit = 10) {
  return useQuery<StatsByStoreRow[]>({
    queryKey: [...statsByStoreQueryKey, { limit }],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_stats_by_store')
        .select('store, total_eur, receipts_count')
        .limit(limit);
      if (error) throw error;
      return (data as RawNumericRow[]).map((r) => ({
        store: asString(r.store),
        total_eur: asNumber(r.total_eur),
        receipts_count: asNumber(r.receipts_count),
      }));
    },
    staleTime: FIVE_MIN,
  });
}

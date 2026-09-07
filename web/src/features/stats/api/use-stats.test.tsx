import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useStatsByCategory,
  useStatsByMonth,
  useStatsByStore,
  useStatsByUser,
  useStatsFilterOptions,
  useStatsSavingsByMonth,
  useStatsWasteByMonth,
} from './use-stats';

type Row = Record<string, unknown>;
type RpcResult = { data: Row[] | null; error: { message: string } | null };

const rpcMock = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<RpcResult>>();

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => rpcMock(name, args) },
}));

beforeEach(() => {
  rpcMock.mockReset();
});

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('period-aware stats queries', () => {
  const range = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };

  it('passes the selected range to the monthly aggregate and coerces numeric values', async () => {
    rpcMock.mockResolvedValue({
      data: [{ month: '2026-08', total_eur: '12.50', receipts_count: '3' }],
      error: null,
    });

    const { result } = renderHook(
      () => useStatsByMonth(range, { categories: ['Молочка'], stores: ['Lidl'] }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpcMock).toHaveBeenCalledWith('stats_by_month', {
      p_date_from: '2026-08-01',
      p_date_to: '2026-08-31',
      p_categories: ['Молочка'],
      p_stores: ['Lidl'],
    });
    expect(result.current.data).toEqual([{ month: '2026-08', total_eur: 12.5, receipts_count: 3 }]);
  });

  it('passes no dates for the all-time aggregate', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useStatsByCategory({}, {}), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpcMock).toHaveBeenCalledWith('stats_by_category', {});
  });

  it('uses the same period for user, savings, waste, and store aggregates', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(
      () => ({
        user: useStatsByUser(range, {}),
        savings: useStatsSavingsByMonth(range, {}),
        waste: useStatsWasteByMonth(range, {}),
        store: useStatsByStore(range, {}, 7),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.store.isSuccess).toBe(true));

    expect(rpcMock).toHaveBeenCalledWith('stats_by_user', {
      p_date_from: '2026-08-01',
      p_date_to: '2026-08-31',
    });
    expect(rpcMock).toHaveBeenCalledWith('stats_savings_by_month', {
      p_date_from: '2026-08-01',
      p_date_to: '2026-08-31',
    });
    expect(rpcMock).toHaveBeenCalledWith('stats_waste_by_month', {
      p_date_from: '2026-08-01',
      p_date_to: '2026-08-31',
    });
    expect(rpcMock).toHaveBeenCalledWith('stats_by_store', {
      p_date_from: '2026-08-01',
      p_date_to: '2026-08-31',
      p_limit: 7,
    });
  });

  it('surfaces database errors', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'denied' } });

    const { result } = renderHook(() => useStatsByMonth({}, {}), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('loads all available categories and stores for the filter dropdowns', async () => {
    rpcMock.mockResolvedValue({
      data: [{ categories: ['Молочка', 'Хліб'], stores: ['Aldi', 'Lidl'] }],
      error: null,
    });

    const { result } = renderHook(() => useStatsFilterOptions(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpcMock).toHaveBeenCalledWith('stats_filter_options', undefined);
    expect(result.current.data).toEqual({
      categories: ['Молочка', 'Хліб'],
      stores: ['Aldi', 'Lidl'],
    });
  });
});

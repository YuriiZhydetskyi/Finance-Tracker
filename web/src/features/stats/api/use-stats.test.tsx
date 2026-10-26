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
import { withAbortSignal } from '@/test/with-abort-signal';

type Row = Record<string, unknown>;
type RpcResult = { data: Row[] | null; error: { message: string } | null };

const rpcMock = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<RpcResult>>();
const signals: AbortSignal[] = [];

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) =>
      withAbortSignal(rpcMock(name, args), (signal) => signals.push(signal)),
  },
}));

beforeEach(() => {
  rpcMock.mockReset();
  signals.length = 0;
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

  it('hands the query signal to the request so superseded periods are cancelled', async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useStatsByMonth(range, {}), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(signals).toHaveLength(1);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
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

  it('keeps the previous period on screen, flagged as placeholder, while a new period loads', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const stableWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    rpcMock.mockResolvedValueOnce({
      data: [{ month: '2026-08', total_eur: 10, receipts_count: 1 }],
      error: null,
    });

    const { result, rerender } = renderHook(
      ({ dateFrom }: { dateFrom: string }) => useStatsByMonth({ dateFrom }, {}),
      { wrapper: stableWrapper, initialProps: { dateFrom: '2026-08-01' } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isPlaceholderData).toBe(false);

    let resolveNext: (value: RpcResult) => void = () => undefined;
    rpcMock.mockReturnValueOnce(
      new Promise<RpcResult>((resolve) => {
        resolveNext = resolve;
      }),
    );
    rerender({ dateFrom: '2026-07-01' });

    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([{ month: '2026-08', total_eur: 10, receipts_count: 1 }]);

    resolveNext({
      data: [{ month: '2026-07', total_eur: 5, receipts_count: 2 }],
      error: null,
    });
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.data).toEqual([{ month: '2026-07', total_eur: 5, receipts_count: 2 }]);
  });
});

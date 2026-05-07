import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useStatsByMonth, useStatsByCategory, useStatsByUser, useStatsByStore } from './use-stats';

type Row = Record<string, unknown>;
type ChainResult = { data: Row[] | null; error: { message: string } | null };

const limitMock = vi.fn<(n: number) => Promise<ChainResult>>();
const orderMock = vi.fn<(col: string, opts: unknown) => { limit: typeof limitMock }>();
const selectMock = vi.fn<
  (cols: string) => Promise<ChainResult> & {
    order: typeof orderMock;
    limit: typeof limitMock;
  }
>();
const fromMock = vi.fn<(table: string) => { select: typeof selectMock }>();

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}));

beforeEach(() => {
  fromMock.mockReset();
  selectMock.mockReset();
  orderMock.mockReset();
  limitMock.mockReset();

  // Default chain wiring: each builder returns the next link, terminal step
  // resolves with whatever the test's `limitMock`/`selectMock` is set to.
  fromMock.mockImplementation(() => ({ select: selectMock }));
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useStatsByMonth', () => {
  it('queries v_stats_by_month, sorts month desc, limits, coerces numerics', async () => {
    selectMock.mockReturnValue(
      Object.assign(Promise.resolve({ data: [], error: null }), {
        order: orderMock,
        limit: limitMock,
      }),
    );
    orderMock.mockReturnValue({ limit: limitMock });
    limitMock.mockResolvedValue({
      data: [
        { month: '2026-05', total_eur: '12.50', receipts_count: '3' },
        { month: '2026-04', total_eur: 4, receipts_count: 1 },
      ],
      error: null,
    });

    const { result } = renderHook(() => useStatsByMonth(12), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fromMock).toHaveBeenCalledWith('v_stats_by_month');
    expect(orderMock).toHaveBeenCalledWith('month', { ascending: false });
    expect(limitMock).toHaveBeenCalledWith(12);
    expect(result.current.data).toEqual([
      { month: '2026-05', total_eur: 12.5, receipts_count: 3 },
      { month: '2026-04', total_eur: 4, receipts_count: 1 },
    ]);
  });

  it('surfaces errors', async () => {
    selectMock.mockReturnValue(
      Object.assign(Promise.resolve({ data: null, error: { message: 'rls' } }), {
        order: orderMock,
        limit: limitMock,
      }),
    );
    orderMock.mockReturnValue({ limit: limitMock });
    limitMock.mockResolvedValue({ data: null, error: { message: 'denied' } });

    const { result } = renderHook(() => useStatsByMonth(), { wrapper });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});

describe('useStatsByCategory', () => {
  it('queries v_stats_by_category and coerces numerics', async () => {
    selectMock.mockResolvedValue({
      data: [
        { category: 'Молочка', total_eur: '8.30', items_count: '5' },
        { category: 'Pfand', total_eur: '-0.25', items_count: '1' },
      ],
      error: null,
    });

    const { result } = renderHook(() => useStatsByCategory(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fromMock).toHaveBeenCalledWith('v_stats_by_category');
    expect(result.current.data).toEqual([
      { category: 'Молочка', total_eur: 8.3, items_count: 5 },
      { category: 'Pfand', total_eur: -0.25, items_count: 1 },
    ]);
  });
});

describe('useStatsByUser', () => {
  it('queries v_stats_by_user', async () => {
    selectMock.mockResolvedValue({
      data: [{ paid_by: 'you@example.com', total_eur: '50', receipts_count: '4' }],
      error: null,
    });

    const { result } = renderHook(() => useStatsByUser(), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fromMock).toHaveBeenCalledWith('v_stats_by_user');
    expect(result.current.data).toEqual([
      { paid_by: 'you@example.com', total_eur: 50, receipts_count: 4 },
    ]);
  });
});

describe('useStatsByStore', () => {
  it('queries v_stats_by_store with limit', async () => {
    selectMock.mockReturnValue(
      Object.assign(Promise.resolve({ data: [], error: null }), {
        limit: limitMock,
      }) as never,
    );
    limitMock.mockResolvedValue({
      data: [{ store: 'Lidl', total_eur: '20', receipts_count: '2' }],
      error: null,
    });

    const { result } = renderHook(() => useStatsByStore(10), { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(fromMock).toHaveBeenCalledWith('v_stats_by_store');
    expect(limitMock).toHaveBeenCalledWith(10);
    expect(result.current.data).toEqual([{ store: 'Lidl', total_eur: 20, receipts_count: 2 }]);
  });
});

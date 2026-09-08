import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWasteItems, type WasteItemRow } from './use-waste-items';

const { rpc, range, operations } = vi.hoisted(() => ({
  rpc: vi.fn(),
  range: vi.fn(),
  operations: [] as unknown[][],
}));

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: { rpc },
}));

beforeEach(() => {
  vi.resetAllMocks();
  operations.length = 0;
  rpc.mockImplementation(() => {
    const builder: Record<string, unknown> = { range };
    for (const method of ['select', 'gt', 'eq', 'gte', 'lte', 'ilike', 'order']) {
      builder[method] = (...args: unknown[]) => {
        operations.push([method, ...args]);
        return builder;
      };
    }
    return builder;
  });
});

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const row = (id: string, wasted_qty = 0): WasteItemRow => ({
  id,
  product_name: 'Apfel rot',
  category: 'Овочі/фрукти',
  qty: 1,
  unit_price_orig: 2,
  total_orig: 2,
  total_eur: 2,
  discount_orig: 0,
  wasted_qty,
  wasted_at: null,
  receipt: { id: 'receipt', date: '2026-09-07', store: 'Aldi', currency: 'EUR', fx_rate_eur: 1 },
});

describe('useWasteItems', () => {
  it.each(['яблуко', 'Apfel', 'apple'])(
    'sends %s to multilingual search without a name-only restriction',
    async (query) => {
      range.mockResolvedValue({ data: [row('one')], error: null });
      const { result } = renderHook(
        () => useWasteItems({ nameSearch: query, showFullyWasted: false }),
        { wrapper: Wrapper },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(rpc).toHaveBeenCalledWith('search_waste_items', { p_query: query });
      expect(result.current.data?.map((item) => item.id)).toEqual(['one']);
      expect(
        operations.some(([method, column]) => method === 'ilike' && column === 'product_name'),
      ).toBe(false);
    },
  );

  it('loads all pages, retains filters and uses a deterministic tie-breaker', async () => {
    range.mockResolvedValueOnce({
      data: Array.from({ length: 500 }, (_, n) => row(String(n), 1)),
      error: null,
    });
    range.mockResolvedValueOnce({ data: [row('last')], error: null });
    const { result } = renderHook(
      () =>
        useWasteItems({
          nameSearch: 'apple',
          category: 'Овочі/фрукти',
          dateFrom: '2026-01-01',
          dateTo: '2026-09-07',
          storeSearch: 'Aldi',
          priceMin: 1,
          priceMax: 10,
          showFullyWasted: false,
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((item) => item.id)).toEqual(['last']);
    expect(range.mock.calls).toEqual([
      [0, 499],
      [500, 999],
    ]);
    for (const operation of [
      ['eq', 'category', 'Овочі/фрукти'],
      ['gte', 'receipt.date', '2026-01-01'],
      ['lte', 'receipt.date', '2026-09-07'],
      ['ilike', 'receipt.store', '%Aldi%'],
      ['gte', 'total_orig', 1],
      ['lte', 'total_orig', 10],
      ['order', 'id', { ascending: false }],
    ])
      expect(
        operations.filter((entry) => JSON.stringify(entry) === JSON.stringify(operation)),
      ).toHaveLength(2);
  });

  it('shows fully wasted rows when requested', async () => {
    range.mockResolvedValue({ data: [row('wasted', 1)], error: null });
    const { result } = renderHook(() => useWasteItems({ showFullyWasted: true }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it('reports a later-page failure instead of returning an incomplete list', async () => {
    range.mockResolvedValueOnce({
      data: Array.from({ length: 500 }, (_, n) => row(String(n))),
      error: null,
    });
    range.mockResolvedValueOnce({ data: null, error: new Error('page failed') });
    const { result } = renderHook(() => useWasteItems({ showFullyWasted: true }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

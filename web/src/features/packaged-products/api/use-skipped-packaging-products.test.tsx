import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientWrapper } from '@/test/query-client';
import { withAbortSignal } from '@/test/with-abort-signal';
import { useSkippedPackagingProducts } from './use-skipped-packaging-products';

const calls = vi.hoisted(() => ({
  eq: vi.fn<(column: string, value: unknown) => void>(),
  result: vi.fn<() => Promise<{ data: unknown; error: { message: string } | null }>>(),
}));
vi.mock('@/shared/lib/supabase-client', () => {
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      calls.eq(column, value);
      return chain;
    },
    order: () => chain,
    limit: () => withAbortSignal(calls.result()),
  };
  return { supabase: { from: (table: string) => (table === 'products' ? chain : undefined) } };
});

beforeEach(() => {
  calls.eq.mockReset();
  calls.result.mockReset();
});

describe('useSkippedPackagingProducts', () => {
  it('reads the rows marked «Без упаковки», reason included', async () => {
    const rows = [
      {
        id: 'p1',
        name: 'Bananen',
        store: 'REWE',
        store_product_code: null,
        category: 'Овочі/фрукти',
        brand: null,
        packaging_not_applicable_reason: 'weighed',
      },
    ];
    calls.result.mockResolvedValue({ data: rows, error: null });

    const { result } = renderHook(() => useSkippedPackagingProducts(), {
      wrapper: QueryClientWrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls.eq).toHaveBeenCalledWith('packaging_not_applicable', true);
    expect(result.current.data).toEqual(rows);
  });

  it('does not query until it is enabled', () => {
    renderHook(() => useSkippedPackagingProducts({ enabled: false }), {
      wrapper: QueryClientWrapper,
    });

    expect(calls.result).not.toHaveBeenCalled();
  });

  it('surfaces a failed read', async () => {
    calls.result.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const { result } = renderHook(() => useSkippedPackagingProducts(), {
      wrapper: QueryClientWrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

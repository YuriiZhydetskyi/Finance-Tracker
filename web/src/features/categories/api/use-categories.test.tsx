import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCategories, useCategoryNames } from './use-categories';

const orderMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: () => ({ select: () => ({ order: () => ({ order: orderMock }) }) }),
  },
}));

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useCategoryNames', () => {
  it('returns one shared empty array until categories load, then their names in order', async () => {
    orderMock.mockResolvedValue({
      data: [
        { name: 'Молочка', group_name: 'Продукти' },
        { name: 'Хліб', group_name: 'Продукти' },
      ],
      error: null,
    });
    const { result, rerender } = renderHook(() => useCategoryNames(), { wrapper: makeWrapper() });

    const initial = result.current;
    expect(initial).toEqual([]);
    rerender();
    expect(result.current).toBe(initial);

    await waitFor(() => expect(result.current).toEqual(['Молочка', 'Хліб']));
    const loaded = result.current;
    rerender();
    expect(result.current).toBe(loaded);
  });

  it('shares one request with useCategories', async () => {
    orderMock.mockReset();
    orderMock.mockResolvedValue({ data: [{ name: 'Хліб', group_name: 'Продукти' }], error: null });
    const { result } = renderHook(() => ({ names: useCategoryNames(), all: useCategories() }), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.all.isSuccess).toBe(true));

    expect(orderMock).toHaveBeenCalledTimes(1);
    expect(result.current.names).toEqual(['Хліб']);
  });
});

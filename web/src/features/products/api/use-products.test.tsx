import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useProductNameEntries, useProductNames } from './use-products';

const orderMock = vi.hoisted(() => vi.fn());

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: { from: () => ({ select: () => ({ order: orderMock }) }) },
}));

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('product name hooks', () => {
  it('derive names and { name } entries from one shared product request', async () => {
    orderMock.mockResolvedValue({
      data: [
        { id: 'p1', name: 'Молоко 1л', store: 'Lidl' },
        { id: 'p2', name: 'Хліб', store: 'Aldi' },
      ],
      error: null,
    });
    const { result, rerender } = renderHook(
      () => ({ names: useProductNames(), entries: useProductNameEntries() }),
      { wrapper: makeWrapper() },
    );

    const empty = result.current;
    expect(empty.names).toEqual([]);
    expect(empty.entries).toEqual([]);
    rerender();
    expect(result.current.names).toBe(empty.names);
    expect(result.current.entries).toBe(empty.entries);

    await waitFor(() => expect(result.current.names).toEqual(['Молоко 1л', 'Хліб']));
    expect(result.current.entries).toEqual([{ name: 'Молоко 1л' }, { name: 'Хліб' }]);
    expect(orderMock).toHaveBeenCalledTimes(1);

    const loaded = result.current;
    rerender();
    expect(result.current.names).toBe(loaded.names);
    expect(result.current.entries).toBe(loaded.entries);
  });
});

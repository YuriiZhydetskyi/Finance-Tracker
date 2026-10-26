import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useReceipt } from './use-receipt';

type Res = { data: unknown; error: { message: string } | null };

const mocks = vi.hoisted(() => ({
  fromMock: vi.fn<(table: string) => void>(),
  receiptResult: vi.fn<() => Promise<Res>>(),
  itemsResult: vi.fn<() => Promise<Res>>(),
  signals: [] as AbortSignal[],
}));

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      mocks.fromMock(table);
      if (table === 'receipts') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          abortSignal: (signal: AbortSignal) => {
            mocks.signals.push(signal);
            return chain;
          },
          maybeSingle: () => mocks.receiptResult(),
        };
        return chain;
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        abortSignal: (signal: AbortSignal) => {
          mocks.signals.push(signal);
          return mocks.itemsResult();
        },
      };
      return chain;
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signals.length = 0;
});

function Wrapper({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useReceipt', () => {
  it('stays idle and sends nothing while there is no id', () => {
    const { result } = renderHook(() => useReceipt(undefined), { wrapper: Wrapper });

    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isPending).toBe(true);
    expect(mocks.fromMock).not.toHaveBeenCalled();
  });

  it('loads the receipt with its items and forwards the query signal to both requests', async () => {
    mocks.receiptResult.mockResolvedValue({ data: { id: 'r1', store: 'Lidl' }, error: null });
    mocks.itemsResult.mockResolvedValue({ data: [{ id: 'i1' }], error: null });

    const { result } = renderHook(() => useReceipt('r1'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      receipt: { id: 'r1', store: 'Lidl' },
      items: [{ id: 'i1' }],
    });
    expect(mocks.signals).toHaveLength(2);
    expect(mocks.signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  });

  it('resolves to null when the receipt is missing or hidden by RLS', async () => {
    mocks.receiptResult.mockResolvedValue({ data: null, error: null });
    mocks.itemsResult.mockResolvedValue({ data: [], error: null });

    const { result } = renderHook(() => useReceipt('missing'), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

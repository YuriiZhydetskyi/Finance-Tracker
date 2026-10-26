import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { receiptQueryKey } from '@/features/receipts';
import { expectReceiptDerivedInvalidation } from '@/test/expect-receipt-derived-invalidation';
import { useReassignPayerMutation } from './use-reassign-payer-mutation';

type ErrorRes = { error: { message: string } | null };

const mocks = vi.hoisted(() => ({
  updateEqMock: vi.fn<(col: string, val: string) => Promise<ErrorRes>>(),
}));

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'receipts') throw new Error(`Unexpected table in test: ${table}`);
      return {
        update: () => ({ eq: (col: string, val: string) => mocks.updateEqMock(col, val) }),
      };
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { qc, Wrapper, invalidateSpy };
}

describe('useReassignPayerMutation', () => {
  it('refreshes the per-user stats and every receipt-derived query after a payer change', async () => {
    mocks.updateEqMock.mockResolvedValue({ error: null });
    const { qc, Wrapper, invalidateSpy } = makeWrapper();
    qc.setQueryData(receiptQueryKey('r1'), { receipt: {}, items: [] });
    const { result } = renderHook(() => useReassignPayerMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ids: ['r1', 'r2'], paid_by: 'her@example.com' });
    });

    expect(mocks.updateEqMock).toHaveBeenCalledTimes(2);
    expect(qc.getQueryData(receiptQueryKey('r1'))).toBeUndefined();
    await waitFor(() => {
      expectReceiptDerivedInvalidation(invalidateSpy);
    });
  });

  it('still invalidates when part of the batch failed', async () => {
    mocks.updateEqMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'boom' } });
    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useReassignPayerMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ ids: ['r1', 'r2'], paid_by: 'her@example.com' }),
      ).rejects.toThrow(/1 з 2/);
    });

    await waitFor(() => {
      expectReceiptDerivedInvalidation(invalidateSpy);
    });
  });
});

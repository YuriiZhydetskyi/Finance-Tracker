import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expectReceiptDerivedInvalidation } from '@/test/expect-receipt-derived-invalidation';
import { useDeleteReceiptMutation } from './use-delete-receipt-mutation';
import { receiptQueryKey } from './receipts-query-keys';

type ErrorRes = { error: { message: string } | null };

const mocks = vi.hoisted(() => ({
  deleteEqMock: vi.fn<(col: string, val: string) => Promise<ErrorRes>>(),
}));

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'receipts') throw new Error(`Unexpected table in test: ${table}`);
      return {
        delete: () => ({ eq: (col: string, val: string) => mocks.deleteEqMock(col, val) }),
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

describe('useDeleteReceiptMutation', () => {
  it('drops the deleted receipt and invalidates every receipt-derived query', async () => {
    mocks.deleteEqMock.mockResolvedValue({ error: null });
    const { qc, Wrapper, invalidateSpy } = makeWrapper();
    qc.setQueryData(receiptQueryKey('r1'), { receipt: {}, items: [] });
    const { result } = renderHook(() => useDeleteReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'r1' });
    });

    expect(mocks.deleteEqMock).toHaveBeenCalledWith('id', 'r1');
    expect(qc.getQueryData(receiptQueryKey('r1'))).toBeUndefined();
    await waitFor(() => {
      expectReceiptDerivedInvalidation(invalidateSpy);
    });
  });

  it('rejects and invalidates nothing when the delete fails', async () => {
    mocks.deleteEqMock.mockResolvedValue({ error: { message: 'RLS denied' } });
    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useDeleteReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'r1' })).rejects.toThrow(
        /^Receipt delete failed/,
      );
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useResolveOrphansMutation } from './use-resolve-orphans-mutation';
import { statementTransactionsQueryKey } from './statement-transactions-query-keys';

type ErrorRes = { error: { message: string } | null };

const mocks = vi.hoisted(() => ({
  eqMock: vi.fn<(payload: unknown, id: string) => Promise<ErrorRes>>(),
}));

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'statement_transactions') {
        return {
          update: (payload: unknown) => ({
            eq: (_col: string, id: string) => mocks.eqMock(payload, id),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.eqMock.mockResolvedValue({ error: null });
});

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, invalidateSpy };
}

describe('useResolveOrphansMutation', () => {
  it('updates each orphan with its own receipt_id and invalidates the query', async () => {
    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useResolveOrphansMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync([
        { id: 'o1', receipt_id: 'r1' },
        { id: 'o2', receipt_id: 'r2' },
      ]);
    });

    expect(mocks.eqMock).toHaveBeenCalledTimes(2);
    expect(mocks.eqMock).toHaveBeenCalledWith(
      { status: 'receipt_created', receipt_id: 'r1' },
      'o1',
    );
    expect(mocks.eqMock).toHaveBeenCalledWith(
      { status: 'receipt_created', receipt_id: 'r2' },
      'o2',
    );

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: statementTransactionsQueryKey });
    });
  });

  it('empty input: resolves without touching the DB', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useResolveOrphansMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync([]);
    });

    expect(mocks.eqMock).not.toHaveBeenCalled();
  });

  it('aggregates partial failures into one rejection and still invalidates', async () => {
    mocks.eqMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'rls denied' } });

    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useResolveOrphansMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync([
          { id: 'o1', receipt_id: 'r1' },
          { id: 'o2', receipt_id: 'r2' },
        ]),
      ).rejects.toThrow(/1 з 2/);
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: statementTransactionsQueryKey });
    });
  });
});

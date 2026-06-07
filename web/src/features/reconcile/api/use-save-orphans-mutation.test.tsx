import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { StatementTransactionInput } from '@finance-tracker/domain';
import { useSaveOrphansMutation } from './use-save-orphans-mutation';
import { statementTransactionsQueryKey } from './statement-transactions-query-keys';

type ErrorRes = { error: { message: string } | null };

const mocks = vi.hoisted(() => ({
  upsertMock: vi.fn<(rows: unknown, opts: unknown) => Promise<ErrorRes>>(),
}));

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'statement_transactions') {
        return {
          upsert: (rows: unknown, opts: unknown) => mocks.upsertMock(rows, opts),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsertMock.mockResolvedValue({ error: null });
});

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, invalidateSpy };
}

const baseInput: StatementTransactionInput = {
  date: '2026-05-04',
  amount_orig: 12.5,
  currency: 'EUR',
  paid_by: 'you@example.com',
  merchant: 'McDonalds',
};

describe('useSaveOrphansMutation', () => {
  it('empty array: resolves 0 and never calls upsert', async () => {
    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useSaveOrphansMutation(), { wrapper: Wrapper });

    let returned: number | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync([]);
    });

    expect(returned).toBe(0);
    expect(mocks.upsertMock).not.toHaveBeenCalled();
    // onSuccess still fires for a 0-length save; the key behaviour is no upsert.
    void invalidateSpy;
  });

  it('N inputs: one upsert of N rows with conflict options, resolves N, invalidates the query', async () => {
    const inputs: StatementTransactionInput[] = [
      baseInput,
      { ...baseInput, amount_orig: 7.0, merchant: 'Lidl' },
      { ...baseInput, amount_orig: 3.5, merchant: 'Rewe' },
    ];

    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useSaveOrphansMutation(), { wrapper: Wrapper });

    let returned: number | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync(inputs);
    });

    expect(returned).toBe(3);
    expect(mocks.upsertMock).toHaveBeenCalledTimes(1);

    const [rows, opts] = mocks.upsertMock.mock.calls[0]!;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows as unknown[]).toHaveLength(3);
    expect(opts).toEqual({ onConflict: 'dedup_key', ignoreDuplicates: true });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: statementTransactionsQueryKey });
    });
  });

  it('genuine same-import duplicates get DIFFERENT dedup_keys so both persist', async () => {
    // Identical date + amount + currency + merchant → disambiguated by occurrence.
    const dup: StatementTransactionInput = { ...baseInput };
    const inputs: StatementTransactionInput[] = [dup, { ...dup }];

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveOrphansMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync(inputs);
    });

    const [rows] = mocks.upsertMock.mock.calls[0]!;
    const dedupKeys = (rows as { dedup_key: string }[]).map((r) => r.dedup_key);
    expect(dedupKeys).toHaveLength(2);
    expect(dedupKeys[0]).not.toBe(dedupKeys[1]);
  });

  it('upsert error: mutation rejects', async () => {
    mocks.upsertMock.mockResolvedValue({ error: { message: 'unique violation' } });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveOrphansMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync([baseInput])).rejects.toThrow(/unique violation/);
    });
  });
});

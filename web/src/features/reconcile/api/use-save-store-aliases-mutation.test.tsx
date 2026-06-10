import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { StoreAliasInput } from '@finance-tracker/domain';
import { useSaveStoreAliasesMutation } from './use-save-store-aliases-mutation';
import { storeAliasesQueryKey } from './store-aliases-query-keys';

type ErrorRes = { error: { message: string } | null };

const mocks = vi.hoisted(() => ({
  upsertMock: vi.fn<(rows: unknown, opts: unknown) => Promise<ErrorRes>>(),
}));

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'store_aliases') {
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

describe('useSaveStoreAliasesMutation', () => {
  it('empty array: resolves 0 and never calls upsert', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveStoreAliasesMutation(), { wrapper: Wrapper });

    let returned: number | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync([]);
    });

    expect(returned).toBe(0);
    expect(mocks.upsertMock).not.toHaveBeenCalled();
  });

  it('normalizes rows, upserts once with the pair conflict key, invalidates the query', async () => {
    const inputs: StoreAliasInput[] = [
      { statement_name: 'AMZN MKTP DE', receipt_store: 'Amazon' },
      { statement_name: 'TGTG Berlin', receipt_store: 'Too Good To Go' },
    ];

    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useSaveStoreAliasesMutation(), { wrapper: Wrapper });

    let returned: number | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync(inputs);
    });

    expect(returned).toBe(2);
    expect(mocks.upsertMock).toHaveBeenCalledTimes(1);

    const [rows, opts] = mocks.upsertMock.mock.calls[0]!;
    expect(opts).toEqual({ onConflict: 'statement_name,receipt_store', ignoreDuplicates: true });
    const persisted = rows as { statement_name: string; receipt_store: string }[];
    expect(persisted[0]).toMatchObject({ statement_name: 'amzn mktp de', receipt_store: 'amazon' });
    expect(persisted[1]).toMatchObject({
      statement_name: 'tgtg berlin',
      receipt_store: 'too good to go',
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: storeAliasesQueryKey });
    });
  });

  it('upsert error: mutation rejects', async () => {
    mocks.upsertMock.mockResolvedValue({ error: { message: 'rls denied' } });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveStoreAliasesMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync([{ statement_name: 'AMZN', receipt_store: 'Amazon' }]),
      ).rejects.toThrow(/rls denied/);
    });
  });
});

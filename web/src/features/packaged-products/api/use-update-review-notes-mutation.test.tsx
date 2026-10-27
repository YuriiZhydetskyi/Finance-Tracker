import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUpdateReviewNotesMutation } from './use-update-review-notes-mutation';
import { packagedProductQueryKey, packagedProductsQueryKey } from './packaged-products-query-keys';

type Result = { error: { message: string } | null };

const mocks = vi.hoisted(() => ({
  update: vi.fn<(patch: Record<string, unknown>) => void>(),
  eq: vi.fn<(column: string, value: string) => Promise<Result>>(),
}));

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'packaged_products') throw new Error(`Unexpected table in test: ${table}`);
      return {
        update: (patch: Record<string, unknown>) => {
          mocks.update(patch);
          return { eq: mocks.eq };
        },
      };
    },
  },
}));

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, invalidate };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useUpdateReviewNotesMutation', () => {
  it('writes the normalized list for the card and refreshes the card and the catalogue', async () => {
    mocks.eq.mockResolvedValue({ error: null });
    const { Wrapper, invalidate } = makeWrapper();
    const { result } = renderHook(() => useUpdateReviewNotesMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'card-1',
        review_notes: ['  Штрихкод розмитий ', 'штрихкод розмитий', ''],
      });
    });

    expect(mocks.update).toHaveBeenCalledWith({ review_notes: ['Штрихкод розмитий'] });
    expect(mocks.eq).toHaveBeenCalledWith('id', 'card-1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: packagedProductQueryKey('card-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: packagedProductsQueryKey });
  });

  it('clears the marker by writing an empty list', async () => {
    mocks.eq.mockResolvedValue({ error: null });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateReviewNotesMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'card-1', review_notes: [] });
    });

    expect(mocks.update).toHaveBeenCalledWith({ review_notes: [] });
  });

  it('rejects an over-long note before calling the database', async () => {
    const { Wrapper, invalidate } = makeWrapper();
    const { result } = renderHook(() => useUpdateReviewNotesMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: 'card-1', review_notes: ['я'.repeat(301)] }),
      ).rejects.toThrow('до 300 символів');
    });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('surfaces a database failure and refreshes nothing', async () => {
    mocks.eq.mockResolvedValue({ error: { message: 'RLS denied' } });
    const { Wrapper, invalidate } = makeWrapper();
    const { result } = renderHook(() => useUpdateReviewNotesMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: 'card-1', review_notes: ['Нова'] }),
      ).rejects.toThrow('Не вдалося оновити примітки');
    });

    expect(invalidate).not.toHaveBeenCalled();
  });
});

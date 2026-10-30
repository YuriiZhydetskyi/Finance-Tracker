import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUpdateAttributesMutation } from './use-update-attributes-mutation';
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

describe('useUpdateAttributesMutation', () => {
  it('writes the normalized object for the card and refreshes the card and the catalogue', async () => {
    mocks.eq.mockResolvedValue({ error: null });
    const { Wrapper, invalidate } = makeWrapper();
    const { result } = renderHook(() => useUpdateAttributesMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: 'card-1',
        attributes: { ' Сорт ': ' Jonagold ', сорт: 'Gala', Клас: '' },
      });
    });

    expect(mocks.update).toHaveBeenCalledWith({ attributes: { Сорт: 'Jonagold' } });
    expect(mocks.eq).toHaveBeenCalledWith('id', 'card-1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: packagedProductQueryKey('card-1') });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: packagedProductsQueryKey });
  });

  it('clears the section by writing an empty object', async () => {
    mocks.eq.mockResolvedValue({ error: null });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateAttributesMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ id: 'card-1', attributes: {} });
    });

    expect(mocks.update).toHaveBeenCalledWith({ attributes: {} });
  });

  it.each([
    ['a key over 60 characters', { ['к'.repeat(61)]: 'x' }],
    ['a value over 300 characters', { Сорт: 'я'.repeat(301) }],
    [
      'more than 30 pairs',
      Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`ключ ${String(i)}`, 'x'])),
    ],
  ])('rejects %s before calling the database', async (_name, attributes) => {
    const { Wrapper, invalidate } = makeWrapper();
    const { result } = renderHook(() => useUpdateAttributesMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync({ id: 'card-1', attributes })).rejects.toThrow(
        'до 60 символів',
      );
    });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('surfaces a database failure and refreshes nothing', async () => {
    mocks.eq.mockResolvedValue({ error: { message: 'RLS denied' } });
    const { Wrapper, invalidate } = makeWrapper();
    const { result } = renderHook(() => useUpdateAttributesMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: 'card-1', attributes: { Сорт: 'Gala' } }),
      ).rejects.toThrow('Не вдалося оновити розділ «Інше»');
    });

    expect(invalidate).not.toHaveBeenCalled();
  });
});

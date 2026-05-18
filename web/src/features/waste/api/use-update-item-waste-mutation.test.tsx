import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUpdateItemWasteMutation } from './use-update-item-waste-mutation';
import { wasteItemsQueryKey } from './use-waste-items';
import { receiptsQueryKey, receiptQueryKey } from '@/features/receipts';
import { wasteByMonthQueryKey, statsByCategoryQueryKey } from '@/features/stats';

type ErrorRes = { error: { message: string } | null };

const itemsUpdateMock = vi.fn<(patch: unknown, col: string, val: string) => Promise<ErrorRes>>();

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'items') {
        return {
          update: (patch: unknown) => ({
            eq: (col: string, val: string) => itemsUpdateMock(patch, col, val),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

beforeEach(() => {
  itemsUpdateMock.mockReset();
});

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, invalidateSpy };
}

describe('useUpdateItemWasteMutation', () => {
  it('sets wasted_at to now() when wastedQty > 0', async () => {
    itemsUpdateMock.mockResolvedValueOnce({ error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateItemWasteMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        itemId: '01HM4N6RZZ7K2P9F8DZ7QWERAA',
        receiptId: '01HM4N6RXX5K2P9F8DZ7QWERTY',
        wastedQty: 1.5,
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(itemsUpdateMock).toHaveBeenCalledOnce();
    const [patch, col, val] = itemsUpdateMock.mock.calls[0]!;
    expect(col).toBe('id');
    expect(val).toBe('01HM4N6RZZ7K2P9F8DZ7QWERAA');
    const p = patch as { wasted_qty: number; wasted_at: string | null };
    expect(p.wasted_qty).toBe(1.5);
    expect(p.wasted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('clears wasted_at to null when wastedQty is 0', async () => {
    itemsUpdateMock.mockResolvedValueOnce({ error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateItemWasteMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        itemId: '01HM4N6RZZ7K2P9F8DZ7QWERAA',
        receiptId: '01HM4N6RXX5K2P9F8DZ7QWERTY',
        wastedQty: 0,
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const [patch] = itemsUpdateMock.mock.calls[0]!;
    const p = patch as { wasted_qty: number; wasted_at: string | null };
    expect(p.wasted_qty).toBe(0);
    expect(p.wasted_at).toBe(null);
  });

  it('invalidates waste, receipts, single receipt, and stats query keys on success', async () => {
    itemsUpdateMock.mockResolvedValueOnce({ error: null });

    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useUpdateItemWasteMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        itemId: '01HM4N6RZZ7K2P9F8DZ7QWERAA',
        receiptId: '01HM4N6RXX5K2P9F8DZ7QWERTY',
        wastedQty: 0.5,
      });
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const keys = invalidateSpy.mock.calls.map((args) => args[0]?.queryKey);
    expect(keys).toContainEqual(wasteItemsQueryKey);
    expect(keys).toContainEqual(receiptsQueryKey);
    expect(keys).toContainEqual(receiptQueryKey('01HM4N6RXX5K2P9F8DZ7QWERTY'));
    expect(keys).toContainEqual(wasteByMonthQueryKey);
    expect(keys).toContainEqual(statsByCategoryQueryKey);
  });

  it('surfaces Supabase error as Error', async () => {
    itemsUpdateMock.mockResolvedValueOnce({ error: { message: 'RLS denied' } });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateItemWasteMutation(), { wrapper: Wrapper });

    await expect(
      result.current.mutateAsync({
        itemId: '01HM4N6RZZ7K2P9F8DZ7QWERAA',
        receiptId: '01HM4N6RXX5K2P9F8DZ7QWERTY',
        wastedQty: 1,
      }),
    ).rejects.toThrow(/RLS denied/);
  });
});

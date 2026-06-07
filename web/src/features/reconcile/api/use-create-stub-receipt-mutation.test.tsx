import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useCreateStubReceiptMutation,
  type CreateStubReceiptVars,
} from './use-create-stub-receipt-mutation';
import { receiptsQueryKey } from '@/features/receipts';

type ErrorRes = { error: { message: string } | null };

// Per-table chain mocks, hoisted so the vi.mock factory below can close over
// them (vi.mock is hoisted above all imports).
const mocks = vi.hoisted(() => ({
  receiptInsertMock: vi.fn<(row: unknown) => Promise<ErrorRes>>(),
  receiptDeleteEqMock: vi.fn<(col: string, val: string) => Promise<ErrorRes>>(),
  itemInsertMock: vi.fn<(row: unknown) => Promise<ErrorRes>>(),
  fxRateMock: vi.fn<(currency: string, dateIso: string) => Promise<number>>(),
}));

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'receipts') {
        return {
          insert: (row: unknown) => mocks.receiptInsertMock(row),
          delete: () => ({
            eq: (col: string, val: string) => mocks.receiptDeleteEqMock(col, val),
          }),
        };
      }
      if (table === 'items') {
        return { insert: (row: unknown) => mocks.itemInsertMock(row) };
      }
      // A stub must never touch product tables — turning those into hard
      // failures makes any accidental write blow up loudly in tests.
      if (table === 'products' || table === 'product_prices') {
        throw new Error(`stub must not touch ${table}`);
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

vi.mock('@/shared/lib/dependencies', () => ({
  fxRateProvider: {
    getRateLive: (currency: string, dateIso: string) => mocks.fxRateMock(currency, dateIso),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fxRateMock.mockResolvedValue(1.0);
  mocks.receiptInsertMock.mockResolvedValue({ error: null });
  mocks.itemInsertMock.mockResolvedValue({ error: null });
  mocks.receiptDeleteEqMock.mockResolvedValue({ error: null });
});

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, invalidateSpy };
}

const baseVars: CreateStubReceiptVars = {
  date: '2026-05-04',
  store: 'McDonalds',
  currency: 'EUR',
  paid_by: 'you@example.com',
  time: null,
  amount_orig: 12.5,
  category: 'Кафе',
  consumed_by: 'shared',
};

describe('useCreateStubReceiptMutation', () => {
  it('happy path: fetches fx, inserts one statement receipt + one detail-less item, never touches products', async () => {
    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useCreateStubReceiptMutation(), { wrapper: Wrapper });

    let returned: { receipt_id: string } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync(baseVars);
    });

    // fx fetched with the receipt's currency + date.
    expect(mocks.fxRateMock).toHaveBeenCalledWith('EUR', '2026-05-04');

    // Exactly one receipt and one item insert.
    expect(mocks.receiptInsertMock).toHaveBeenCalledTimes(1);
    expect(mocks.itemInsertMock).toHaveBeenCalledTimes(1);
    expect(mocks.receiptDeleteEqMock).not.toHaveBeenCalled();

    const insertedReceipt = mocks.receiptInsertMock.mock.calls[0]?.[0] as {
      id: string;
      source: string;
    };
    expect(insertedReceipt.source).toBe('statement');

    const insertedItem = mocks.itemInsertMock.mock.calls[0]?.[0] as {
      product_id: string | null;
      qty: number;
      unit_price_orig: number;
      receipt_id: string;
    };
    expect(insertedItem.product_id).toBeNull();
    expect(insertedItem.qty).toBe(1);
    expect(insertedItem.unit_price_orig).toBe(12.5);
    expect(insertedItem.receipt_id).toBe(insertedReceipt.id);

    // Resolves to the inserted receipt id.
    expect(returned?.receipt_id).toBe(insertedReceipt.id);

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: receiptsQueryKey });
    });
  });

  it('rejects and never inserts the item or deletes when the receipt insert fails', async () => {
    mocks.receiptInsertMock.mockResolvedValue({ error: { message: 'RLS denied' } });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateStubReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(baseVars)).rejects.toThrow();
    });

    expect(mocks.itemInsertMock).not.toHaveBeenCalled();
    expect(mocks.receiptDeleteEqMock).not.toHaveBeenCalled();
  });

  it('rolls back the receipt and rejects with the item error when item insert fails but cleanup succeeds', async () => {
    mocks.itemInsertMock.mockResolvedValue({ error: { message: 'check constraint' } });
    mocks.receiptDeleteEqMock.mockResolvedValue({ error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateStubReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(baseVars)).rejects.toThrow(/check constraint/);
    });

    expect(mocks.receiptDeleteEqMock).toHaveBeenCalledTimes(1);
    const insertedReceipt = mocks.receiptInsertMock.mock.calls[0]?.[0] as { id: string };
    const [col, val] = mocks.receiptDeleteEqMock.mock.calls[0]!;
    expect(col).toBe('id');
    expect(val).toBe(insertedReceipt.id);
  });

  it('surfaces the CLEANUP error (not the item error) when both item insert and rollback fail', async () => {
    mocks.itemInsertMock.mockResolvedValue({ error: { message: 'check constraint' } });
    mocks.receiptDeleteEqMock.mockResolvedValue({ error: { message: 'rollback exploded' } });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useCreateStubReceiptMutation(), { wrapper: Wrapper });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.mutateAsync(baseVars);
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    // The data-integrity failure (rollback failed → manual cleanup needed) must
    // be the surfaced message, carrying the cleanup error — NOT swallowed by the
    // original item-insert error.
    expect(message).toMatch(/видали чек вручну/);
    expect(message).toMatch(/rollback exploded/);
    expect(message).not.toMatch(/check constraint/);

    expect(mocks.receiptDeleteEqMock).toHaveBeenCalledTimes(1);
  });
});

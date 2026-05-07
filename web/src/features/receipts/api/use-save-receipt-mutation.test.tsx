import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useSaveReceiptMutation,
  type SaveReceiptInput,
  type SaveItemInput,
} from './use-save-receipt-mutation';
import { receiptsQueryKey } from './receipts-query-keys';

// Per-table insert/delete mocks so each test can pin behaviour for receipts vs items.
const receiptInsertMock = vi.fn<(row: unknown) => Promise<{ error: { message: string } | null }>>();
const itemsInsertMock = vi.fn<(rows: unknown) => Promise<{ error: { message: string } | null }>>();
const receiptDeleteEqMock =
  vi.fn<(col: string, val: string) => Promise<{ error: { message: string } | null }>>();
const fxRateMock = vi.fn<(currency: string, dateIso: string) => Promise<number>>();

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'receipts') {
        return {
          insert: (row: unknown) => receiptInsertMock(row),
          delete: () => ({
            eq: (col: string, val: string) => receiptDeleteEqMock(col, val),
          }),
        };
      }
      if (table === 'items') {
        return {
          insert: (rows: unknown) => itemsInsertMock(rows),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
  },
}));

vi.mock('@/shared/lib/dependencies', () => ({
  fxRateProvider: {
    getRateLive: (currency: string, dateIso: string) => fxRateMock(currency, dateIso),
  },
}));

beforeEach(() => {
  receiptInsertMock.mockReset();
  itemsInsertMock.mockReset();
  receiptDeleteEqMock.mockReset();
  fxRateMock.mockReset();
});

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, invalidateSpy };
}

const baseReceipt: SaveReceiptInput = {
  date: '2026-05-04',
  store: 'Lidl',
  currency: 'EUR',
  paid_by: 'you@example.com',
  source: 'manual',
  photo_url: null,
  note: null,
  raw_ocr_json: null,
};

const baseItems: SaveItemInput[] = [
  {
    product_id: null,
    product_name: 'Молоко',
    category: 'Молочка',
    qty: 2,
    unit_price_orig: 1.5,
    consumed_by: 'shared',
    note: null,
    wasted_qty: 0,
    discount_orig: 0,
  },
  {
    product_id: null,
    product_name: 'Хліб',
    category: 'Бакалія',
    qty: 1,
    unit_price_orig: 1.99,
    consumed_by: 'shared',
    note: null,
    wasted_qty: 0,
    discount_orig: 0,
  },
];

describe('useSaveReceiptMutation', () => {
  it('happy path EUR: FX = 1.0, inserts receipt + items, returns ids', async () => {
    fxRateMock.mockResolvedValue(1.0);
    receiptInsertMock.mockResolvedValue({ error: null });
    itemsInsertMock.mockResolvedValue({ error: null });

    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    let returned: { receipt_id: string; items_count: number } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ receipt: baseReceipt, items: baseItems });
    });

    expect(fxRateMock).toHaveBeenCalledWith('EUR', '2026-05-04');
    expect(receiptInsertMock).toHaveBeenCalledTimes(1);
    expect(itemsInsertMock).toHaveBeenCalledTimes(1);
    expect(receiptDeleteEqMock).not.toHaveBeenCalled();
    expect(returned?.items_count).toBe(2);
    expect(returned?.receipt_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // Invalidation runs after onSuccess; wait for it.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: receiptsQueryKey });
    });
  });

  it('UAH: forwards currency+date to fxRateProvider and propagates the rate', async () => {
    fxRateMock.mockResolvedValue(0.0245);
    receiptInsertMock.mockResolvedValue({ error: null });
    itemsInsertMock.mockResolvedValue({ error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        receipt: { ...baseReceipt, currency: 'UAH' },
        items: baseItems,
      });
    });

    expect(fxRateMock).toHaveBeenCalledWith('UAH', '2026-05-04');
    const insertedReceipt = receiptInsertMock.mock.calls[0]?.[0] as {
      currency: string;
      fx_rate_eur: number;
      total_orig: number;
    };
    expect(insertedReceipt.currency).toBe('UAH');
    expect(insertedReceipt.fx_rate_eur).toBe(0.0245);
    // total_orig = 2 * 1.5 + 1 * 1.99 = 4.99
    expect(insertedReceipt.total_orig).toBe(4.99);

    // Items don't carry fx_rate_eur (it's used at construction to compute total_eur,
    // then discarded — see schemas.ts ItemSchema). Verify the rate flowed via total_eur.
    const insertedItems = itemsInsertMock.mock.calls[0]?.[0] as {
      total_orig: number;
      total_eur: number;
    }[];
    expect(insertedItems[0]?.total_orig).toBe(3.0);
    expect(insertedItems[0]?.total_eur).toBe(0.07); // 3.00 * 0.0245 = 0.0735 → 0.07
    expect(insertedItems[1]?.total_orig).toBe(1.99);
    expect(insertedItems[1]?.total_eur).toBe(0.05); // 1.99 * 0.0245 = 0.048755 → 0.05
  });

  it('skips items.insert when items array is empty', async () => {
    fxRateMock.mockResolvedValue(1.0);
    receiptInsertMock.mockResolvedValue({ error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    let returned: { receipt_id: string; items_count: number } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ receipt: baseReceipt, items: [] });
    });

    expect(receiptInsertMock).toHaveBeenCalledTimes(1);
    expect(itemsInsertMock).not.toHaveBeenCalled();
    expect(receiptDeleteEqMock).not.toHaveBeenCalled();
    expect(returned?.items_count).toBe(0);
  });

  it('throws and does not touch items when receipt insert fails', async () => {
    fxRateMock.mockResolvedValue(1.0);
    receiptInsertMock.mockResolvedValue({ error: { message: 'RLS denied' } });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ receipt: baseReceipt, items: baseItems }),
      ).rejects.toThrow(/Receipt insert failed: RLS denied/);
    });

    expect(itemsInsertMock).not.toHaveBeenCalled();
    expect(receiptDeleteEqMock).not.toHaveBeenCalled();
  });

  it('rolls back the receipt when items insert fails', async () => {
    fxRateMock.mockResolvedValue(1.0);
    receiptInsertMock.mockResolvedValue({ error: null });
    itemsInsertMock.mockResolvedValue({ error: { message: 'check constraint' } });
    receiptDeleteEqMock.mockResolvedValue({ error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ receipt: baseReceipt, items: baseItems }),
      ).rejects.toThrow(/Items insert failed: check constraint/);
    });

    expect(receiptDeleteEqMock).toHaveBeenCalledTimes(1);
    const insertedReceipt = receiptInsertMock.mock.calls[0]?.[0] as { id: string };
    const [col, val] = receiptDeleteEqMock.mock.calls[0]!;
    expect(col).toBe('id');
    expect(val).toBe(insertedReceipt.id);
  });

  it('does not invalidate the receipts query when the mutation fails', async () => {
    fxRateMock.mockResolvedValue(1.0);
    receiptInsertMock.mockResolvedValue({ error: { message: 'boom' } });

    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ receipt: baseReceipt, items: baseItems }),
      ).rejects.toThrow();
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

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
import { productsQueryKey } from '@/features/products/api/use-products';

type ErrorRes = { error: { message: string } | null };
type DataRes = { data: unknown; error: { message: string } | null };

// Per-table chain mocks. Each call returns a Promise. The chain wrappers below
// route every `from(table).<op>(...)` to the right vi.fn so tests can pin
// behaviour and assert call shapes individually.

const productsSelectMock = vi.fn<(col: string, val: string) => Promise<DataRes>>();
const productsInsertMock = vi.fn<(rows: unknown) => Promise<ErrorRes>>();
const productsUpdateMock = vi.fn<(patch: unknown, col: string, val: string) => Promise<ErrorRes>>();
const receiptInsertMock = vi.fn<(row: unknown) => Promise<ErrorRes>>();
const itemsInsertMock = vi.fn<(rows: unknown) => Promise<ErrorRes>>();
const receiptDeleteEqMock = vi.fn<(col: string, val: string) => Promise<ErrorRes>>();
const pricesInsertMock = vi.fn<(rows: unknown) => Promise<ErrorRes>>();
const fxRateMock = vi.fn<(currency: string, dateIso: string) => Promise<number>>();

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'products') {
        return {
          select: () => ({
            eq: (col: string, val: string) => productsSelectMock(col, val),
          }),
          insert: (rows: unknown) => productsInsertMock(rows),
          update: (patch: unknown) => ({
            eq: (col: string, val: string) => productsUpdateMock(patch, col, val),
          }),
        };
      }
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
      if (table === 'product_prices') {
        return {
          insert: (rows: unknown) => pricesInsertMock(rows),
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
  productsSelectMock.mockReset();
  productsInsertMock.mockReset();
  productsUpdateMock.mockReset();
  receiptInsertMock.mockReset();
  itemsInsertMock.mockReset();
  receiptDeleteEqMock.mockReset();
  pricesInsertMock.mockReset();
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
    store_product_code: null,
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
    store_product_code: null,
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
  it('happy path EUR: FX = 1.0, creates new products + receipt + items + price snapshots', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({ data: [], error: null });
    productsInsertMock.mockResolvedValue({ error: null });
    receiptInsertMock.mockResolvedValue({ error: null });
    itemsInsertMock.mockResolvedValue({ error: null });
    pricesInsertMock.mockResolvedValue({ error: null });

    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    let returned: { receipt_id: string; items_count: number } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ receipt: baseReceipt, items: baseItems });
    });

    expect(fxRateMock).toHaveBeenCalledWith('EUR', '2026-05-04');
    expect(productsSelectMock).toHaveBeenCalledWith('store', 'Lidl');
    expect(productsInsertMock).toHaveBeenCalledTimes(1);
    expect(productsUpdateMock).not.toHaveBeenCalled();
    expect(receiptInsertMock).toHaveBeenCalledTimes(1);
    expect(itemsInsertMock).toHaveBeenCalledTimes(1);
    expect(pricesInsertMock).toHaveBeenCalledTimes(1);
    expect(receiptDeleteEqMock).not.toHaveBeenCalled();
    expect(returned?.items_count).toBe(2);
    expect(returned?.receipt_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const newProducts = productsInsertMock.mock.calls[0]?.[0] as {
      id: string;
      name: string;
      store: string;
    }[];
    expect(newProducts).toHaveLength(2);
    expect(newProducts[0]?.store).toBe('Lidl');

    const insertedItems = itemsInsertMock.mock.calls[0]?.[0] as {
      product_id: string | null;
    }[];
    expect(insertedItems[0]?.product_id).toBe(newProducts[0]?.id);

    const prices = pricesInsertMock.mock.calls[0]?.[0] as {
      price_orig: number;
      price_net: number;
      currency: string;
      date: string;
    }[];
    expect(prices).toHaveLength(2);
    expect(prices[0]?.price_orig).toBe(1.5);
    expect(prices[0]?.price_net).toBe(1.5);
    expect(prices[0]?.currency).toBe('EUR');
    expect(prices[0]?.date).toBe('2026-05-04');

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: receiptsQueryKey });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: productsQueryKey });
    });
  });

  it('links to an existing product (matched by code) and skips product insert', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({
      data: [
        {
          id: '01HM4N6RPP3K2P9F8DZ7QWERTZ',
          name: 'Multivitamin 1l',
          store: 'Lidl',
          store_product_code: '297855',
          category: 'Напої',
        },
      ],
      error: null,
    });
    productsInsertMock.mockResolvedValue({ error: null });
    receiptInsertMock.mockResolvedValue({ error: null });
    itemsInsertMock.mockResolvedValue({ error: null });
    pricesInsertMock.mockResolvedValue({ error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        receipt: baseReceipt,
        items: [
          {
            product_id: null,
            product_name: 'Multivitamin 1l',
            store_product_code: '297855',
            category: 'Напої',
            qty: 1,
            unit_price_orig: 1.39,
            consumed_by: 'shared',
            note: null,
            wasted_qty: 0,
            discount_orig: 0,
          },
        ],
      });
    });

    expect(productsInsertMock).not.toHaveBeenCalled();
    const insertedItems = itemsInsertMock.mock.calls[0]?.[0] as { product_id: string | null }[];
    expect(insertedItems[0]?.product_id).toBe('01HM4N6RPP3K2P9F8DZ7QWERTZ');
    const prices = pricesInsertMock.mock.calls[0]?.[0] as { product_id: string }[];
    expect(prices[0]?.product_id).toBe('01HM4N6RPP3K2P9F8DZ7QWERTZ');
  });

  it('backfills code on a code-less existing product when item has a code', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({
      data: [
        {
          id: '01HM4N6RPP3K2P9F8DZ7QWERAA',
          name: 'Молоко',
          store: 'Lidl',
          store_product_code: null,
          category: 'Молочка',
        },
      ],
      error: null,
    });
    productsInsertMock.mockResolvedValue({ error: null });
    productsUpdateMock.mockResolvedValue({ error: null });
    receiptInsertMock.mockResolvedValue({ error: null });
    itemsInsertMock.mockResolvedValue({ error: null });
    pricesInsertMock.mockResolvedValue({ error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        receipt: baseReceipt,
        items: [
          {
            product_id: null,
            product_name: 'Молоко',
            store_product_code: '12345',
            category: 'Молочка',
            qty: 1,
            unit_price_orig: 1.5,
            consumed_by: 'shared',
            note: null,
            wasted_qty: 0,
            discount_orig: 0,
          },
        ],
      });
    });

    expect(productsUpdateMock).toHaveBeenCalledTimes(1);
    expect(productsUpdateMock).toHaveBeenCalledWith(
      { store_product_code: '12345' },
      'id',
      '01HM4N6RPP3K2P9F8DZ7QWERAA',
    );
    expect(productsInsertMock).not.toHaveBeenCalled();
    const insertedItems = itemsInsertMock.mock.calls[0]?.[0] as { product_id: string | null }[];
    expect(insertedItems[0]?.product_id).toBe('01HM4N6RPP3K2P9F8DZ7QWERAA');
  });

  it('UAH: forwards currency+date to fxRateProvider and propagates the rate', async () => {
    fxRateMock.mockResolvedValue(0.0245);
    productsSelectMock.mockResolvedValue({ data: [], error: null });
    productsInsertMock.mockResolvedValue({ error: null });
    receiptInsertMock.mockResolvedValue({ error: null });
    itemsInsertMock.mockResolvedValue({ error: null });
    pricesInsertMock.mockResolvedValue({ error: null });

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
    expect(insertedReceipt.total_orig).toBe(4.99);

    const insertedItems = itemsInsertMock.mock.calls[0]?.[0] as {
      total_orig: number;
      total_eur: number;
    }[];
    expect(insertedItems[0]?.total_orig).toBe(3.0);
    expect(insertedItems[0]?.total_eur).toBe(0.07);
    expect(insertedItems[1]?.total_orig).toBe(1.99);
    expect(insertedItems[1]?.total_eur).toBe(0.05);

    // Price snapshots get the receipt currency.
    const prices = pricesInsertMock.mock.calls[0]?.[0] as { currency: string }[];
    expect(prices[0]?.currency).toBe('UAH');
  });

  it('skips items.insert and prices.insert when items array is empty', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({ data: [], error: null });
    receiptInsertMock.mockResolvedValue({ error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    let returned: { receipt_id: string; items_count: number } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ receipt: baseReceipt, items: [] });
    });

    expect(receiptInsertMock).toHaveBeenCalledTimes(1);
    expect(itemsInsertMock).not.toHaveBeenCalled();
    expect(pricesInsertMock).not.toHaveBeenCalled();
    expect(productsInsertMock).not.toHaveBeenCalled();
    expect(receiptDeleteEqMock).not.toHaveBeenCalled();
    expect(returned?.items_count).toBe(0);
  });

  it('throws and does not touch items when receipt insert fails', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({ data: [], error: null });
    productsInsertMock.mockResolvedValue({ error: null });
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
    productsSelectMock.mockResolvedValue({ data: [], error: null });
    productsInsertMock.mockResolvedValue({ error: null });
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

  it('rolls back the receipt when product_prices insert fails', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({ data: [], error: null });
    productsInsertMock.mockResolvedValue({ error: null });
    receiptInsertMock.mockResolvedValue({ error: null });
    itemsInsertMock.mockResolvedValue({ error: null });
    pricesInsertMock.mockResolvedValue({ error: { message: 'fk violation' } });
    receiptDeleteEqMock.mockResolvedValue({ error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ receipt: baseReceipt, items: baseItems }),
      ).rejects.toThrow(/Price snapshot insert failed: fk violation/);
    });

    expect(receiptDeleteEqMock).toHaveBeenCalledTimes(1);
  });

  it('does not invalidate the receipts query when the mutation fails', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({ data: [], error: null });
    productsInsertMock.mockResolvedValue({ error: null });
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

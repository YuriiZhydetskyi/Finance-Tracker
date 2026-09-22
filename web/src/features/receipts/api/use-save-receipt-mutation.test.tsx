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

type DataRes = { data: unknown; error: { message: string } | null };

type RpcArgs = {
  p_receipt: {
    id: string;
    store: string;
    currency: string;
    fx_rate_eur: number;
    total_orig: number;
    source: string;
  };
  p_items: {
    id: string;
    price_id: string;
    receipt_id: string;
    product_id: string | null;
    total_orig: number;
    total_eur: number;
  }[];
  p_new_products: { id: string; name: string; store: string }[];
  p_product_backfills: { id: string; store_product_code: string }[];
  p_product_enrichments: { id: string; product_family_id?: string | null }[];
  p_replace: boolean;
};

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const productsSelectMock = vi.fn<(col: string, val: string) => Promise<DataRes>>();
const rpcMock = vi.fn<(name: string, args: RpcArgs) => Promise<DataRes>>();
const fxRateMock = vi.fn<(currency: string, dateIso: string) => Promise<number>>();

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'products') {
        return {
          select: () => ({
            eq: (col: string, val: string) => productsSelectMock(col, val),
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    },
    rpc: (name: string, args: RpcArgs) => rpcMock(name, args),
  },
}));

vi.mock('@/shared/lib/dependencies', () => ({
  fxRateProvider: {
    getRateLive: (currency: string, dateIso: string) => fxRateMock(currency, dateIso),
  },
}));

beforeEach(() => {
  productsSelectMock.mockReset();
  rpcMock.mockReset();
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

function rpcArgs(call = 0): RpcArgs {
  const args = rpcMock.mock.calls[call]?.[1];
  if (!args) throw new Error(`rpc call ${String(call)} missing`);
  return args;
}

function mockRpcSuccess() {
  rpcMock.mockImplementation((_name, args) =>
    Promise.resolve({
      data: { receipt_id: args.p_receipt.id, items_count: args.p_items.length },
      error: null,
    }),
  );
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

const singleItem = (overrides: Partial<SaveItemInput>): SaveItemInput => ({
  product_id: null,
  product_name: 'Молоко',
  store_product_code: null,
  category: 'Молочка',
  qty: 1,
  unit_price_orig: 1.5,
  consumed_by: 'shared',
  note: null,
  wasted_qty: 0,
  discount_orig: 0,
  ...overrides,
});

describe('useSaveReceiptMutation', () => {
  it('new products: one RPC call in insert mode with linked items and price ids', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({ data: [], error: null });
    mockRpcSuccess();

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    let returned: { receipt_id: string; items_count: number } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ receipt: baseReceipt, items: baseItems });
    });

    expect(fxRateMock).toHaveBeenCalledWith('EUR', '2026-05-04');
    expect(productsSelectMock).toHaveBeenCalledWith('store', 'Lidl');
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0]?.[0]).toBe('save_receipt_bundle');

    const args = rpcArgs();
    expect(args.p_replace).toBe(false);
    expect(args.p_new_products).toHaveLength(2);
    expect(args.p_new_products[0]?.store).toBe('Lidl');
    expect(args.p_items[0]?.product_id).toBe(args.p_new_products[0]?.id);
    expect(args.p_items[1]?.product_id).toBe(args.p_new_products[1]?.id);
    expect(args.p_product_backfills).toEqual([]);
    for (const item of args.p_items) {
      expect(item.price_id).toMatch(ULID_PATTERN);
      expect(item.receipt_id).toBe(args.p_receipt.id);
    }
    expect(new Set(args.p_items.map((it) => it.price_id)).size).toBe(2);

    expect(returned?.items_count).toBe(2);
    expect(returned?.receipt_id).toMatch(ULID_PATTERN);
    expect(returned?.receipt_id).toBe(args.p_receipt.id);
  });

  it('links to an existing product matched by code without creating a new one', async () => {
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
    mockRpcSuccess();

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        receipt: baseReceipt,
        items: [
          singleItem({
            product_name: 'Multivitamin 1l',
            store_product_code: '297855',
            category: 'Напої',
            unit_price_orig: 1.39,
          }),
        ],
      });
    });

    const args = rpcArgs();
    expect(args.p_new_products).toEqual([]);
    expect(args.p_product_backfills).toEqual([]);
    expect(args.p_items[0]?.product_id).toBe('01HM4N6RPP3K2P9F8DZ7QWERTZ');
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
    mockRpcSuccess();

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        receipt: baseReceipt,
        items: [singleItem({ store_product_code: '12345' })],
      });
    });

    const args = rpcArgs();
    expect(args.p_product_backfills).toEqual([
      { id: '01HM4N6RPP3K2P9F8DZ7QWERAA', store_product_code: '12345' },
    ]);
    expect(args.p_new_products).toEqual([]);
    expect(args.p_items[0]?.product_id).toBe('01HM4N6RPP3K2P9F8DZ7QWERAA');
  });

  it('enriches an existing product that has no family with the item family', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({
      data: [
        {
          id: '01HM4N6RPP3K2P9F8DZ7QWERAB',
          name: 'Молоко',
          store: 'Lidl',
          store_product_code: null,
          category: 'Молочка',
          product_family_id: null,
          product_variant_id: null,
          brand: null,
          is_organic: null,
        },
      ],
      error: null,
    });
    mockRpcSuccess();

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        receipt: baseReceipt,
        items: [singleItem({ product_family_id: 'milk' })],
      });
    });

    const args = rpcArgs();
    expect(args.p_new_products).toEqual([]);
    expect(args.p_product_enrichments).toHaveLength(1);
    expect(args.p_product_enrichments[0]).toMatchObject({
      id: '01HM4N6RPP3K2P9F8DZ7QWERAB',
      product_family_id: 'milk',
    });
  });

  it('UAH: forwards currency+date to fxRateProvider and propagates the rate', async () => {
    fxRateMock.mockResolvedValue(0.0245);
    productsSelectMock.mockResolvedValue({ data: [], error: null });
    mockRpcSuccess();

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        receipt: { ...baseReceipt, currency: 'UAH' },
        items: baseItems,
      });
    });

    expect(fxRateMock).toHaveBeenCalledWith('UAH', '2026-05-04');
    const args = rpcArgs();
    expect(args.p_receipt.currency).toBe('UAH');
    expect(args.p_receipt.fx_rate_eur).toBe(0.0245);
    expect(args.p_receipt.total_orig).toBe(4.99);
    expect(args.p_items[0]?.total_orig).toBe(3.0);
    expect(args.p_items[0]?.total_eur).toBe(0.07);
    expect(args.p_items[1]?.total_orig).toBe(1.99);
    expect(args.p_items[1]?.total_eur).toBe(0.05);
  });

  it('sends an empty item list when there are no items', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({ data: [], error: null });
    mockRpcSuccess();

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    let returned: { receipt_id: string; items_count: number } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ receipt: baseReceipt, items: [] });
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    const args = rpcArgs();
    expect(args.p_items).toEqual([]);
    expect(args.p_new_products).toEqual([]);
    expect(returned?.items_count).toBe(0);
  });

  it('reads items_count from the RPC result, including numeric strings', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({ data: [], error: null });
    rpcMock.mockResolvedValue({ data: { receipt_id: 'ignored', items_count: '5' }, error: null });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    let returned: { receipt_id: string; items_count: number } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ receipt: baseReceipt, items: baseItems });
    });

    expect(returned?.items_count).toBe(5);
    expect(returned?.receipt_id).toBe(rpcArgs().p_receipt.id);
  });

  it('rejects with "Receipt save failed" and does not invalidate when the RPC fails', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({ data: [], error: null });
    rpcMock.mockResolvedValue({ data: null, error: { message: 'RLS denied' } });

    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ receipt: baseReceipt, items: baseItems }),
      ).rejects.toThrow(/^Receipt save failed: RLS denied/);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('does not call the RPC when the products fetch fails', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({ data: null, error: { message: 'timeout' } });

    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ receipt: baseReceipt, items: baseItems }),
      ).rejects.toThrow(/Products fetch failed: timeout/);
    });

    expect(rpcMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('invalidates receipts and products on success', async () => {
    fxRateMock.mockResolvedValue(1.0);
    productsSelectMock.mockResolvedValue({ data: [], error: null });
    mockRpcSuccess();

    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useSaveReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ receipt: baseReceipt, items: baseItems });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: receiptsQueryKey });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: productsQueryKey });
    });
  });
});

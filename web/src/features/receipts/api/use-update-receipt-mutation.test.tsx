import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Receipt } from '@finance-tracker/domain';
import { useUpdateReceiptMutation } from './use-update-receipt-mutation';
import type { SaveItemInput, SaveReceiptInput } from './use-save-receipt-mutation';
import { receiptQueryKey, receiptsQueryKey } from './receipts-query-keys';
import { productsQueryKey } from '@/features/products/api/use-products';

type DataRes = { data: unknown; error: { message: string } | null };

type RpcArgs = {
  p_receipt: {
    id: string;
    store: string;
    source: string;
    currency: string;
    date: string;
    fx_rate_eur: number;
    total_orig: number;
    total_eur: number;
    created_at: string;
  };
  p_items: { id: string; price_id: string; receipt_id: string; product_id: string | null }[];
  p_new_products: { id: string; store: string }[];
  p_product_backfills: unknown[];
  p_product_enrichments: unknown[];
  p_replace: boolean;
};

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
  productsSelectMock.mockResolvedValue({ data: [], error: null });
  rpcMock.mockImplementation((_name, args) =>
    Promise.resolve({
      data: { receipt_id: args.p_receipt.id, items_count: args.p_items.length },
      error: null,
    }),
  );
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

const RECEIPT_ID = '01HM4N6RPP3K2P9F8DZ7QWREC1';

const existing: Receipt = {
  id: RECEIPT_ID,
  date: '2026-05-04',
  store: 'Lidl',
  store_address: null,
  currency: 'UAH',
  total_orig: 100,
  fx_rate_eur: 0.0245,
  total_eur: 2.45,
  paid_by: 'you@example.com',
  photo_url: null,
  photo_path: null,
  merchant_order_id: null,
  source: 'photo',
  raw_ocr_json: null,
  note: null,
  time: null,
  created_at: '2026-05-04T10:00:00.000Z',
  updated_at: '2026-05-04T10:00:00.000Z',
};

const receiptInput: SaveReceiptInput = {
  date: '2026-05-04',
  store: 'Lidl',
  currency: 'UAH',
  paid_by: 'you@example.com',
  source: 'photo',
  photo_url: null,
  note: null,
  raw_ocr_json: null,
};

const items: SaveItemInput[] = [
  {
    product_id: null,
    product_name: 'Молоко',
    store_product_code: null,
    category: 'Молочка',
    qty: 2,
    unit_price_orig: 40,
    consumed_by: 'shared',
    note: null,
    wasted_qty: 0,
    discount_orig: 0,
  },
];

describe('useUpdateReceiptMutation', () => {
  it('replaces the receipt through one RPC call with source forced to edit', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateReceiptMutation(), { wrapper: Wrapper });

    let returned: { receipt_id: string; items_count: number } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({
        id: RECEIPT_ID,
        existing,
        receipt: { ...receiptInput, store: 'Lidl City' },
        items,
      });
    });

    expect(productsSelectMock).toHaveBeenCalledWith('store', 'Lidl City');
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0]?.[0]).toBe('save_receipt_bundle');
    const args = rpcArgs();
    expect(args.p_replace).toBe(true);
    expect(args.p_receipt.id).toBe(RECEIPT_ID);
    expect(args.p_receipt.source).toBe('edit');
    expect(args.p_receipt.store).toBe('Lidl City');
    expect(args.p_receipt.created_at).toBe(existing.created_at);
    expect(args.p_receipt.total_orig).toBe(80);
    expect(args.p_new_products).toHaveLength(1);
    expect(args.p_new_products[0]?.store).toBe('Lidl City');
    expect(args.p_items[0]?.receipt_id).toBe(RECEIPT_ID);
    expect(args.p_items[0]?.product_id).toBe(args.p_new_products[0]?.id);
    expect(args.p_items[0]?.price_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(returned).toEqual({ receipt_id: RECEIPT_ID, items_count: 1 });
  });

  it('keeps the existing FX rate when currency and date are unchanged', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: RECEIPT_ID,
        existing,
        receipt: receiptInput,
        items,
      });
    });

    expect(fxRateMock).not.toHaveBeenCalled();
    expect(rpcArgs().p_receipt.fx_rate_eur).toBe(existing.fx_rate_eur);
  });

  it('refetches the FX rate once when the date changes', async () => {
    fxRateMock.mockResolvedValue(0.025);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUpdateReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: RECEIPT_ID,
        existing,
        receipt: { ...receiptInput, date: '2026-05-05' },
        items,
      });
    });

    expect(fxRateMock).toHaveBeenCalledTimes(1);
    expect(fxRateMock).toHaveBeenCalledWith('UAH', '2026-05-05');
    const args = rpcArgs();
    expect(args.p_receipt.fx_rate_eur).toBe(0.025);
    expect(args.p_receipt.date).toBe('2026-05-05');
    expect(args.p_receipt.total_eur).toBe(2);
  });

  it('rejects with "Receipt update failed" and does not invalidate when the RPC fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'receipt not found' } });
    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useUpdateReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: RECEIPT_ID, existing, receipt: receiptInput, items }),
      ).rejects.toThrow(/^Receipt update failed: receipt not found/);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('invalidates receipts, the edited receipt and products on success', async () => {
    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useUpdateReceiptMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        id: RECEIPT_ID,
        existing,
        receipt: receiptInput,
        items,
      });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: receiptsQueryKey });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: receiptQueryKey(RECEIPT_ID) });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: productsQueryKey });
    });
  });
});

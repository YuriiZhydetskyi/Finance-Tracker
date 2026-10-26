import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { productTaxonomyQueryKey } from '@/features/products/api/use-products';
import { receiptQueryKey } from '@/features/receipts/api/receipts-query-keys';
import { expectReceiptDerivedInvalidation } from '@/test/expect-receipt-derived-invalidation';
import {
  purchaseCorrectionQueryKey,
  usePurchaseCorrectionMutation,
} from './use-purchase-correction';

type RpcRes = { error: { message: string } | null };

const mocks = vi.hoisted(() => ({
  rpcMock: vi.fn<(name: string, args: Record<string, unknown>) => Promise<RpcRes>>(),
}));

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: { rpc: (name: string, args: Record<string, unknown>) => mocks.rpcMock(name, args) },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper, invalidateSpy };
}

const vars = {
  itemId: 'item-1',
  receiptId: 'receipt-1',
  productName: ' Молоко ',
  category: 'Молочка',
  productFamilyId: null,
  productVariantId: null,
  rememberRule: true,
};

describe('usePurchaseCorrectionMutation', () => {
  it('invalidates the purchase, its receipt, the taxonomy and every receipt-derived query', async () => {
    mocks.rpcMock.mockResolvedValue({ error: null });
    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => usePurchaseCorrectionMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync(vars);
    });

    expect(mocks.rpcMock).toHaveBeenCalledWith(
      'correct_purchase_classification',
      expect.objectContaining({ p_item_id: 'item-1', p_product_name: 'Молоко' }),
    );
    await waitFor(() => {
      expectReceiptDerivedInvalidation(invalidateSpy);
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: purchaseCorrectionQueryKey('item-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: receiptQueryKey('receipt-1') });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: productTaxonomyQueryKey });
    });
  });

  it('invalidates nothing when the RPC fails', async () => {
    mocks.rpcMock.mockResolvedValue({ error: { message: 'denied' } });
    const { Wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => usePurchaseCorrectionMutation(), { wrapper: Wrapper });

    await act(async () => {
      await expect(result.current.mutateAsync(vars)).rejects.toThrow(/^Purchase correction failed/);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

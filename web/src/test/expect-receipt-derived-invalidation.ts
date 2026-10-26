import { expect, type MockInstance } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { packagingCandidatesQueryKey } from '@/features/packaged-products/api/packaged-products-query-keys';
import { productsQueryKey } from '@/features/products/api/use-products';
import { receiptsQueryKey } from '@/features/receipts/api/receipts-query-keys';
import { statsQueryKey } from '@/features/stats/api/use-stats';
import { wasteItemsQueryKey } from '@/features/waste/api/use-waste-items';

export function expectReceiptDerivedInvalidation(
  invalidateSpy: MockInstance<QueryClient['invalidateQueries']>,
) {
  for (const queryKey of [
    receiptsQueryKey,
    productsQueryKey,
    statsQueryKey,
    wasteItemsQueryKey,
    packagingCandidatesQueryKey,
  ]) {
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
  }
}

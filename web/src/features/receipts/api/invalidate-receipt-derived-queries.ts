import type { QueryClient } from '@tanstack/react-query';
import { packagingCandidatesQueryKey } from '@/features/packaged-products/api/packaged-products-query-keys';
import { productsQueryKey } from '@/features/products/api/use-products';
import { statsQueryKey } from '@/features/stats/api/use-stats';
import { wasteItemsQueryKey } from '@/features/waste/api/use-waste-items';
import { receiptsQueryKey } from './receipts-query-keys';

/**
 * Every cache entry whose content is computed from receipts and items: the
 * receipt lists (and duplicate checks), the products catalogue, all `/stats`
 * aggregates incl. filter options and category details, the waste list and the
 * packaging queue (list and count share the prefix). A mutation that adds,
 * edits, removes or re-attributes receipts or items calls this instead of
 * naming keys itself, so a new derived query is wired up in one place.
 *
 * Add a per-receipt `receiptQueryKey(id)` invalidation at the call site when
 * the mutation targets a known receipt.
 */
export async function invalidateReceiptDerivedQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: receiptsQueryKey }),
    queryClient.invalidateQueries({ queryKey: productsQueryKey }),
    queryClient.invalidateQueries({ queryKey: statsQueryKey }),
    queryClient.invalidateQueries({ queryKey: wasteItemsQueryKey }),
    queryClient.invalidateQueries({ queryKey: packagingCandidatesQueryKey }),
  ]);
}

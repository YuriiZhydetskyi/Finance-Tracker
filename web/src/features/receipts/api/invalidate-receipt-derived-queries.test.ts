import { describe, it, expect, vi } from 'vitest';
import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { categoriesQueryKey } from '@/features/categories/api/use-categories';
import {
  packagedProductsQueryKey,
  packagingCandidatesQueryKey,
} from '@/features/packaged-products/api/packaged-products-query-keys';
import { productsQueryKey } from '@/features/products/api/use-products';
import {
  statsByCategoryQueryKey,
  statsByMonthQueryKey,
  statsCategoryDetailsQueryKey,
  statsFilterOptionsQueryKey,
  wasteByMonthQueryKey,
} from '@/features/stats/api/use-stats';
import { wasteItemsQueryKey } from '@/features/waste/api/use-waste-items';
import { invalidateReceiptDerivedQueries } from './invalidate-receipt-derived-queries';
import { receiptQueryKey, receiptsQueryKey } from './receipts-query-keys';

vi.mock('@/shared/lib/supabase-client', () => ({ supabase: {} }));

const derivedKeys: Record<string, QueryKey> = {
  'receipt list': [...receiptsQueryKey, { filters: undefined, limit: 30 }],
  'duplicate check': [...receiptsQueryKey, 'duplicates', { store: 'Lidl' }],
  products: productsQueryKey,
  'stats by month': [...statsByMonthQueryKey, { dateFrom: '2026-01-01' }, {}],
  'stats by category': [...statsByCategoryQueryKey, {}, {}],
  'stats waste by month': [...wasteByMonthQueryKey, {}, {}],
  'stats filter options': statsFilterOptionsQueryKey,
  'stats category details': [...statsCategoryDetailsQueryKey, {}, {}],
  'waste items': [...wasteItemsQueryKey, { filters: { showFullyWasted: false } }],
  'packaging candidates': [...packagingCandidatesQueryKey, '', null, null, '2026-09-27', 200],
  'packaging queue summary': [...packagingCandidatesQueryKey, 'summary', '', '2026-09-27'],
};

const untouchedKeys: Record<string, QueryKey> = {
  categories: categoriesQueryKey,
  'allowlist check': ['auth', 'allowlist', 'user@example.com'],
  'import batches': ['receipt-import-batches'],
  'packaged products': packagedProductsQueryKey,
  'single receipt': receiptQueryKey('r1'),
};

function seededClient(): QueryClient {
  const queryClient = new QueryClient();
  for (const key of [...Object.values(derivedKeys), ...Object.values(untouchedKeys)]) {
    queryClient.setQueryData(key, []);
  }
  return queryClient;
}

describe('invalidateReceiptDerivedQueries', () => {
  it.each(Object.entries(derivedKeys))('marks %s as stale', async (_name, key) => {
    const queryClient = seededClient();

    await invalidateReceiptDerivedQueries(queryClient);

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it.each(Object.entries(untouchedKeys))('leaves %s alone', async (_name, key) => {
    const queryClient = seededClient();

    await invalidateReceiptDerivedQueries(queryClient);

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  });
});

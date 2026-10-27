import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientWrapper } from '@/test/query-client';
import { withAbortSignal } from '@/test/with-abort-signal';
import {
  usePackagingCandidates,
  usePackagingCandidatesCount,
  usePackagingQueueSummary,
} from './use-packaging-candidates';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/shared/lib/supabase-client', () => ({ supabase: { rpc } }));

beforeEach(() => {
  rpc.mockReset();
});

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    product_id: 'p1',
    product_name: 'Original',
    store: 'REWE',
    store_product_code: null,
    category: 'Снеки',
    brand: 'Pringles',
    is_organic: null,
    product_family_id: null,
    product_variant_id: null,
    receipt_labels: ['Original'],
    purchases_count: 2,
    total_qty: '2.000',
    total_eur: '5.98',
    last_purchased_on: '2026-10-20',
    last_price_orig: '2.99',
    last_currency: 'EUR',
    group_key: 'pringles original',
    group_purchases_count: 3,
    other_store_purchases_count: 1,
    ...overrides,
  };
}

describe('usePackagingCandidates', () => {
  it('asks only for rows bought since the window start when it is given', async () => {
    rpc.mockReturnValue(withAbortSignal(Promise.resolve({ data: [candidateRow()], error: null })));

    const { result } = renderHook(
      () => usePackagingCandidates({ query: '', lastPurchasedSince: '2026-09-27', limit: 500 }),
      { wrapper: QueryClientWrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith('search_packaging_candidates', {
      p_query: '',
      p_limit: 500,
      p_last_purchased_since: '2026-09-27',
    });
    expect(result.current.data?.[0]).toMatchObject({
      product_id: 'p1',
      group_purchases_count: 3,
      other_store_purchases_count: 1,
      total_eur: 5.98,
      last_purchased_on: '2026-10-20',
    });
  });

  it('sends no window parameter when listing every row', async () => {
    rpc.mockReturnValue(withAbortSignal(Promise.resolve({ data: [], error: null })));

    const { result } = renderHook(() => usePackagingCandidates({ query: 'pesto' }), {
      wrapper: QueryClientWrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(args).toEqual({ p_query: 'pesto', p_limit: 200 });
    expect(args).not.toHaveProperty('p_last_purchased_since');
  });

  it('keeps a windowed and an unwindowed list apart in the cache', async () => {
    rpc.mockReturnValue(withAbortSignal(Promise.resolve({ data: [], error: null })));

    const { result: windowed } = renderHook(
      () => usePackagingCandidates({ lastPurchasedSince: '2026-09-27' }),
      { wrapper: QueryClientWrapper },
    );
    const { result: everything } = renderHook(() => usePackagingCandidates({}), {
      wrapper: QueryClientWrapper,
    });

    await waitFor(() => expect(windowed.current.isSuccess).toBe(true));
    await waitFor(() => expect(everything.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('surfaces a failed call', async () => {
    rpc.mockReturnValue(
      withAbortSignal(Promise.resolve({ data: null, error: new Error('function missing') })),
    );

    const { result } = renderHook(() => usePackagingCandidates({}), {
      wrapper: QueryClientWrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('usePackagingQueueSummary', () => {
  it('returns both counts, however PostgREST types them', async () => {
    rpc.mockReturnValue(
      withAbortSignal(
        Promise.resolve({ data: [{ total_count: '120', recent_count: 18 }], error: null }),
      ),
    );

    const { result } = renderHook(
      () => usePackagingQueueSummary({ query: 'pesto', lastPurchasedSince: '2026-09-27' }),
      { wrapper: QueryClientWrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith('packaging_queue_summary', {
      p_query: 'pesto',
      p_last_purchased_since: '2026-09-27',
    });
    expect(result.current.data).toEqual({ total_count: 120, recent_count: 18 });
  });

  it('treats an empty response as an empty queue', async () => {
    rpc.mockReturnValue(withAbortSignal(Promise.resolve({ data: [], error: null })));

    const { result } = renderHook(() => usePackagingQueueSummary(), {
      wrapper: QueryClientWrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ total_count: 0, recent_count: 0 });
  });
});

describe('usePackagingCandidatesCount', () => {
  it('is the number of rows bought inside the window', async () => {
    rpc.mockReturnValue(
      withAbortSignal(
        Promise.resolve({ data: [{ total_count: 120, recent_count: 18 }], error: null }),
      ),
    );

    const { result } = renderHook(() => usePackagingCandidatesCount('2026-09-27'), {
      wrapper: QueryClientWrapper,
    });

    await waitFor(() => expect(result.current.data).toBe(18));
    expect(rpc).toHaveBeenCalledWith('packaging_queue_summary', {
      p_query: '',
      p_last_purchased_since: '2026-09-27',
    });
  });
});

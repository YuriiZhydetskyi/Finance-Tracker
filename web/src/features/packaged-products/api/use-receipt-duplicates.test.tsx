import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientWrapper } from '@/test/query-client';
import { withAbortSignal } from '@/test/with-abort-signal';
import { usePackagingReceiptDuplicates } from './use-receipt-duplicates';

const chain = vi.hoisted(() => {
  const calls: { method: string; args: unknown[] }[] = [];
  const state = { rows: [] as unknown[], error: null as Error | null };
  return { calls, state };
});
const from = vi.hoisted(() => vi.fn());
vi.mock('@/shared/lib/supabase-client', () => ({ supabase: { from } }));

function builder() {
  const proxy: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'gte', 'lte', 'limit']) {
    proxy[method] = (...args: unknown[]) => {
      chain.calls.push({ method, args });
      return method === 'limit'
        ? withAbortSignal(Promise.resolve({ data: chain.state.rows, error: chain.state.error }))
        : proxy;
    };
  }
  return proxy;
}

beforeEach(() => {
  chain.calls.length = 0;
  chain.state.rows = [];
  chain.state.error = null;
  from.mockReset().mockImplementation(() => builder());
});

const stored = (store: string, overrides: Record<string, unknown> = {}) => ({
  id: `r-${store}`,
  store,
  date: '2026-09-13',
  total_orig: 23.45,
  currency: 'EUR',
  ...overrides,
});

const SUMMARY = { store: 'REWE', date: '2026-09-13', total: 23.45, currency: 'EUR' };

describe('usePackagingReceiptDuplicates', () => {
  it('narrows by date and by the total within a cent either way', async () => {
    chain.state.rows = [stored('REWE')];

    const { result } = renderHook(() => usePackagingReceiptDuplicates(SUMMARY), {
      wrapper: QueryClientWrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(from).toHaveBeenCalledWith('receipts');
    expect(chain.calls).toContainEqual({ method: 'eq', args: ['date', '2026-09-13'] });
    expect(chain.calls).toContainEqual({ method: 'gte', args: ['total_orig', 23.44] });
    expect(chain.calls).toContainEqual({ method: 'lte', args: ['total_orig', 23.46] });
  });

  it('keeps only receipts from a shop that looks like the same one', async () => {
    chain.state.rows = [
      stored('REWE Ahmad-Shah Hessami oHG', { id: 'same-shop' }),
      stored('Aldi Süd', { id: 'other-shop' }),
    ];

    const { result } = renderHook(() => usePackagingReceiptDuplicates(SUMMARY), {
      wrapper: QueryClientWrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((row) => row.id)).toEqual(['same-shop']);
  });

  it.each([
    ['no summary', null],
    ['no store', { ...SUMMARY, store: null }],
    ['no date', { ...SUMMARY, date: null }],
    ['no total', { ...SUMMARY, total: null }],
  ])('does not query with %s', (_name, summary) => {
    const { result } = renderHook(() => usePackagingReceiptDuplicates(summary), {
      wrapper: QueryClientWrapper,
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(from).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useReceipts, type ReceiptFilters } from './use-receipts';

type DataRes = { data: unknown[] | null; error: { message: string } | null };

const finalThenMock = vi.fn<() => Promise<DataRes>>();
const captured = {
  ilikes: [] as { col: string; val: unknown }[],
  eqs: [] as { col: string; val: unknown }[],
  gtes: [] as { col: string; val: unknown }[],
  ltes: [] as { col: string; val: unknown }[],
  orders: [] as { col: string; asc: boolean }[],
  limit: null as number | null,
};

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'receipts') throw new Error(`Unexpected table: ${table}`);
      const chain = {
        select: () => chain,
        ilike: (col: string, val: unknown) => {
          captured.ilikes.push({ col, val });
          return chain;
        },
        eq: (col: string, val: unknown) => {
          captured.eqs.push({ col, val });
          return chain;
        },
        gte: (col: string, val: unknown) => {
          captured.gtes.push({ col, val });
          return chain;
        },
        lte: (col: string, val: unknown) => {
          captured.ltes.push({ col, val });
          return chain;
        },
        order: (col: string, opts: { ascending: boolean }) => {
          captured.orders.push({ col, asc: opts.ascending });
          return chain;
        },
        limit: (n: number) => {
          captured.limit = n;
          return finalThenMock();
        },
      };
      return chain;
    },
  },
}));

beforeEach(() => {
  finalThenMock.mockReset();
  captured.ilikes = [];
  captured.eqs = [];
  captured.gtes = [];
  captured.ltes = [];
  captured.orders = [];
  captured.limit = null;
});

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper };
}

async function runWith(filters?: ReceiptFilters) {
  const { Wrapper } = makeWrapper();
  finalThenMock.mockResolvedValue({ data: [], error: null });
  const { result } = renderHook(() => useReceipts(filters), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
}

describe('useReceipts — no filters', () => {
  it('orders by date desc then created_at desc and limits 30, with no filter chains', async () => {
    await runWith();
    expect(captured.ilikes).toEqual([]);
    expect(captured.eqs).toEqual([]);
    expect(captured.gtes).toEqual([]);
    expect(captured.ltes).toEqual([]);
    expect(captured.orders).toEqual([
      { col: 'date', asc: false },
      { col: 'created_at', asc: false },
    ]);
    expect(captured.limit).toBe(30);
  });
});

describe('useReceipts — individual filters', () => {
  it('applies ILIKE %store% when store filter set', async () => {
    await runWith({ store: 'Lidl' });
    expect(captured.ilikes).toEqual([{ col: 'store', val: '%Lidl%' }]);
  });

  it('applies date range bounds when both ends provided', async () => {
    await runWith({ dateFrom: '2026-05-01', dateTo: '2026-05-15' });
    expect(captured.gtes).toContainEqual({ col: 'date', val: '2026-05-01' });
    expect(captured.ltes).toContainEqual({ col: 'date', val: '2026-05-15' });
  });

  it('applies only the lower date bound when dateTo is absent', async () => {
    await runWith({ dateFrom: '2026-05-01' });
    expect(captured.gtes).toEqual([{ col: 'date', val: '2026-05-01' }]);
    expect(captured.ltes).toEqual([]);
  });

  it('applies paid_by as exact match', async () => {
    await runWith({ paidBy: 'you@example.com' });
    expect(captured.eqs).toEqual([{ col: 'paid_by', val: 'you@example.com' }]);
  });

  it('applies amountMin and amountMax as total_eur bounds', async () => {
    await runWith({ amountMin: 10, amountMax: 50 });
    expect(captured.gtes).toContainEqual({ col: 'total_eur', val: 10 });
    expect(captured.ltes).toContainEqual({ col: 'total_eur', val: 50 });
  });

  it('applies amountMin = 0 (not skipped by falsy guard)', async () => {
    await runWith({ amountMin: 0 });
    expect(captured.gtes).toEqual([{ col: 'total_eur', val: 0 }]);
  });
});

describe('useReceipts — combined filters', () => {
  it('chains all filters in a single query', async () => {
    await runWith({
      store: 'Lidl',
      dateFrom: '2026-05-01',
      dateTo: '2026-05-15',
      paidBy: 'you@example.com',
      amountMin: 5,
      amountMax: 100,
    });
    expect(captured.ilikes).toEqual([{ col: 'store', val: '%Lidl%' }]);
    expect(captured.eqs).toEqual([{ col: 'paid_by', val: 'you@example.com' }]);
    expect(captured.gtes).toEqual([
      { col: 'date', val: '2026-05-01' },
      { col: 'total_eur', val: 5 },
    ]);
    expect(captured.ltes).toEqual([
      { col: 'date', val: '2026-05-15' },
      { col: 'total_eur', val: 100 },
    ]);
  });
});

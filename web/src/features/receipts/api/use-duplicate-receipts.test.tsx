import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useDuplicateReceipts,
  withinTimeWindow,
  type DuplicateCandidate,
} from './use-duplicate-receipts';

type DataRes = { data: DuplicateCandidate[] | null; error: { message: string } | null };

const finalThenMock = vi.fn<() => Promise<DataRes>>();
const captured = {
  eqs: [] as { col: string; val: unknown }[],
  gte: null as { col: string; val: unknown } | null,
  lte: null as { col: string; val: unknown } | null,
  neq: null as { col: string; val: unknown } | null,
  order: null as { col: string; asc: boolean } | null,
  limit: null as number | null,
};

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'receipts') throw new Error(`Unexpected table: ${table}`);
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          captured.eqs.push({ col, val });
          return chain;
        },
        gte: (col: string, val: unknown) => {
          captured.gte = { col, val };
          return chain;
        },
        lte: (col: string, val: unknown) => {
          captured.lte = { col, val };
          return chain;
        },
        neq: (col: string, val: unknown) => {
          captured.neq = { col, val };
          return chain;
        },
        order: (col: string, opts: { ascending: boolean }) => {
          captured.order = { col, asc: opts.ascending };
          return chain;
        },
        // limit returns the awaited result — PostgREST builder is thenable here.
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
  captured.eqs = [];
  captured.gte = null;
  captured.lte = null;
  captured.neq = null;
  captured.order = null;
  captured.limit = null;
});

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return { Wrapper };
}

describe('useDuplicateReceipts — enabled gating', () => {
  it('does not fire query when store is missing', async () => {
    const { Wrapper } = makeWrapper();
    finalThenMock.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(
      () => useDuplicateReceipts({ store: '', date: '2026-05-04', total_orig: 10, time: null }),
      { wrapper: Wrapper },
    );
    // give react-query an opportunity to fire if it were enabled
    await new Promise((r) => setTimeout(r, 10));
    expect(finalThenMock).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('does not fire when total_orig is 0', async () => {
    const { Wrapper } = makeWrapper();
    finalThenMock.mockResolvedValue({ data: [], error: null });
    renderHook(
      () => useDuplicateReceipts({ store: 'Lidl', date: '2026-05-04', total_orig: 0, time: null }),
      { wrapper: Wrapper },
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(finalThenMock).not.toHaveBeenCalled();
  });

  it('does not fire when date is missing', async () => {
    const { Wrapper } = makeWrapper();
    finalThenMock.mockResolvedValue({ data: [], error: null });
    renderHook(
      () => useDuplicateReceipts({ store: 'Lidl', date: null, total_orig: 10, time: null }),
      { wrapper: Wrapper },
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(finalThenMock).not.toHaveBeenCalled();
  });
});

describe('useDuplicateReceipts — query shape', () => {
  it('filters by store, date, and total ±0.01 tolerance, orders DESC, limits 3', async () => {
    const { Wrapper } = makeWrapper();
    finalThenMock.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(
      () =>
        useDuplicateReceipts({
          store: 'Lidl',
          date: '2026-05-04',
          total_orig: 18.5,
          time: '14:30',
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(captured.eqs).toContainEqual({ col: 'store', val: 'Lidl' });
    expect(captured.eqs).toContainEqual({ col: 'date', val: '2026-05-04' });
    expect(captured.gte).toEqual({ col: 'total_orig', val: 18.49 });
    expect(captured.lte).toEqual({ col: 'total_orig', val: 18.51 });
    expect(captured.order).toEqual({ col: 'created_at', asc: false });
    expect(captured.limit).toBe(3);
    expect(captured.neq).toBeNull();
  });

  it('adds .neq("id", excludeId) when excludeId is passed', async () => {
    const { Wrapper } = makeWrapper();
    finalThenMock.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(
      () =>
        useDuplicateReceipts({
          store: 'Lidl',
          date: '2026-05-04',
          total_orig: 18.5,
          time: null,
          excludeId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(captured.neq).toEqual({ col: 'id', val: '01HZZZZZZZZZZZZZZZZZZZZZZZ' });
  });
});

describe('useDuplicateReceipts — time-window filter', () => {
  const lidlAt = (id: string, time: string | null): DuplicateCandidate => ({
    id,
    store: 'Lidl',
    date: '2026-05-04',
    time,
    total_orig: 18.5,
    currency: 'EUR',
  });

  it('drops a candidate whose time differs by more than 10 min', async () => {
    const { Wrapper } = makeWrapper();
    finalThenMock.mockResolvedValue({
      data: [lidlAt('A', '08:00:00'), lidlAt('B', '14:25:00'), lidlAt('C', '14:40:00')],
      error: null,
    });
    const { result } = renderHook(
      () =>
        useDuplicateReceipts({
          store: 'Lidl',
          date: '2026-05-04',
          total_orig: 18.5,
          time: '14:30',
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const ids = result.current.data?.map((r) => r.id);
    // B is within window (5 min), C just barely (10 min), A is way off (6+ hours)
    expect(ids).toEqual(['B', 'C']);
  });

  it('keeps candidates when either side lacks time (fallback to structural match)', async () => {
    const { Wrapper } = makeWrapper();
    finalThenMock.mockResolvedValue({
      data: [lidlAt('A', null), lidlAt('B', '08:00:00')],
      error: null,
    });
    const { result } = renderHook(
      () =>
        useDuplicateReceipts({
          store: 'Lidl',
          date: '2026-05-04',
          total_orig: 18.5,
          time: null,
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((r) => r.id)).toEqual(['A', 'B']);
  });

  it('returns [] when supabase returns []', async () => {
    const { Wrapper } = makeWrapper();
    finalThenMock.mockResolvedValue({ data: [], error: null });
    const { result } = renderHook(
      () =>
        useDuplicateReceipts({
          store: 'Lidl',
          date: '2026-05-04',
          total_orig: 18.5,
          time: '14:30',
        }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('withinTimeWindow (pure)', () => {
  it('returns true when both times are null', () => {
    expect(withinTimeWindow(null, null)).toBe(true);
  });
  it('returns true when candidate time is null', () => {
    expect(withinTimeWindow(null, '14:30')).toBe(true);
  });
  it('returns true when input time is null', () => {
    expect(withinTimeWindow('14:30:00', null)).toBe(true);
    expect(withinTimeWindow('14:30:00', undefined)).toBe(true);
  });
  it('returns true within 10 min window', () => {
    expect(withinTimeWindow('14:30:00', '14:35')).toBe(true);
    expect(withinTimeWindow('14:30:00', '14:40')).toBe(true);
    expect(withinTimeWindow('14:30:00', '14:20')).toBe(true);
  });
  it('returns false outside 10 min window', () => {
    expect(withinTimeWindow('14:30:00', '14:41')).toBe(false);
    expect(withinTimeWindow('14:30:00', '08:00')).toBe(false);
  });
  it('returns true on unparseable input (defensive — never drop a candidate due to parse failure)', () => {
    expect(withinTimeWindow('garbage', '14:30')).toBe(true);
  });
});

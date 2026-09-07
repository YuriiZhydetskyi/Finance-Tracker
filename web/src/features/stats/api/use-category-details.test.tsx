import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useCategoryDetails } from './use-category-details';
import type { StatsDetailItem } from '../category-details';

const pageMock =
  vi.fn<() => Promise<{ data: StatsDetailItem[] | null; error: { message: string } | null }>>();
const callMock = vi.fn();
vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: {
    from: (table: string) => {
      callMock('from', table);
      const query = {
        select: (value: string) => {
          callMock('select', value);
          return query;
        },
        order: (value: string) => {
          callMock('order', value);
          return query;
        },
        limit: (value: number) => {
          callMock('limit', value);
          return query;
        },
        gt: (key: string, value: string) => {
          callMock('gt', key, value);
          return query;
        },
        gte: (key: string, value: string) => {
          callMock('gte', key, value);
          return query;
        },
        lte: (key: string, value: string) => {
          callMock('lte', key, value);
          return query;
        },
        in: (key: string, value: string[]) => {
          callMock('in', key, value);
          return query;
        },
        abortSignal: () => pageMock(),
      };
      return query;
    },
  },
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const item: StatsDetailItem = {
  id: 'a',
  receipt_id: 'r',
  total_eur: 10,
  category: 'Овочі/фрукти',
  product_family_id: 'tomato',
  family: { name_uk: 'Помідори' },
  receipt: { date: '2026-08-01', store: 'Lidl' },
};

describe('category detail queries', () => {
  beforeEach(() => {
    callMock.mockReset();
    pageMock.mockReset();
  });

  it('reads every page even below the requested cap, with inclusive dates and scoped filters', async () => {
    pageMock
      .mockResolvedValueOnce({ data: [item], error: null })
      .mockResolvedValueOnce({ data: [{ ...item, id: 'b', total_eur: 20 }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(
      () =>
        useCategoryDetails(
          { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
          { categories: ['Овочі/фрукти'], stores: ['Lidl'] },
          true,
        ),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total_eur).toBe(30);
    expect(pageMock).toHaveBeenCalledTimes(3);
    expect(callMock).toHaveBeenCalledWith('gt', 'id', 'a');
    expect(callMock).toHaveBeenCalledWith('gt', 'id', 'b');
    expect(callMock).toHaveBeenCalledWith('gte', 'receipt.date', '2026-08-01');
    expect(callMock).toHaveBeenCalledWith('lte', 'receipt.date', '2026-08-31');
    expect(callMock).toHaveBeenCalledWith('in', 'category', ['Овочі/фрукти']);
    expect(callMock).toHaveBeenCalledWith('in', 'receipt.store', ['Lidl']);
    expect(callMock).toHaveBeenCalledWith('select', expect.stringContaining('receipts!inner'));
  });

  it.each([{ categories: [] }, { stores: [] }])(
    'returns no purchases for an empty selection: %j',
    async (filters) => {
      const { result } = renderHook(() => useCategoryDetails({}, filters, true), { wrapper });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.items_count).toBe(0);
      expect(pageMock).not.toHaveBeenCalled();
    },
  );

  it('does not expose partial totals when a later page fails', async () => {
    pageMock
      .mockResolvedValueOnce({ data: [item], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Offline' } });
    const { result } = renderHook(() => useCategoryDetails({}, {}, true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('does not fetch while the period or scope is unresolved', () => {
    renderHook(() => useCategoryDetails({}, {}, false), { wrapper });
    expect(pageMock).not.toHaveBeenCalled();
  });
});

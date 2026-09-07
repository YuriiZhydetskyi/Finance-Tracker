import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { summarizeCategoryDetails, type StatsDetailItem } from '@/features/stats/category-details';
import type { StatsDateRange, StatsFilters } from '@/features/stats';
import type * as CategoriesFeature from '@/features/categories';
import { routeTree } from '@/routeTree.gen';

type RpcResult = { data: Record<string, unknown>[]; error: null };
const rpcMock = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<RpcResult>>();
const detailMock = vi.fn();
const categories = [
  { name: 'Овочі/фрукти', group_name: 'Продукти' },
  { name: 'Молочка', group_name: 'Продукти' },
];
const detailItems: StatsDetailItem[] = [
  {
    id: 'a',
    receipt_id: 'r1',
    total_eur: 10,
    category: 'Овочі/фрукти',
    product_family_id: 'tomato',
    family: { name_uk: 'Помідори' },
    receipt: { date: '2026-08-01', store: 'Lidl' },
  },
  {
    id: 'b',
    receipt_id: 'r2',
    total_eur: 10,
    category: 'Овочі/фрукти',
    product_family_id: 'tomato',
    family: { name_uk: 'Помідори' },
    receipt: { date: '2026-08-02', store: 'REWE' },
  },
  {
    id: 'c',
    receipt_id: 'r2',
    total_eur: 10,
    category: 'Овочі/фрукти',
    product_family_id: 'cucumber',
    family: { name_uk: 'Огірки' },
    receipt: { date: '2026-08-02', store: 'REWE' },
  },
  {
    id: 'd',
    receipt_id: 'r1',
    total_eur: 10,
    category: 'Молочка',
    product_family_id: null,
    family: null,
    receipt: { date: '2026-08-01', store: 'Lidl' },
  },
];

vi.mock('@/features/categories', async (importOriginal) => ({
  ...(await importOriginal<typeof CategoriesFeature>()),
  useCategories: () => ({
    data: categories,
    isSuccess: true,
    isError: false,
    isLoading: false,
    error: null,
  }),
}));
vi.mock('@/features/stats/api/use-category-details', () => ({
  useCategoryDetails: (range: StatsDateRange, filters: StatsFilters, enabled: boolean) => {
    detailMock(range, filters, enabled);
    return {
      isError: false,
      error: null,
      data: enabled
        ? summarizeCategoryDetails(
            detailItems.filter(
              (item) =>
                (!filters.categories || filters.categories.includes(item.category)) &&
                (!filters.stores || filters.stores.includes(item.receipt.store)),
            ),
          )
        : undefined,
    };
  },
}));

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => rpcMock(name, args) },
}));
vi.mock('@/features/auth', () => ({
  Header: () => null,
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Pie: () => null }));

function openStats(url = '/stats') {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('saved statistics filters on page load', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    window.localStorage.clear();
    rpcMock.mockReset();
    detailMock.mockClear();
    rpcMock.mockImplementation((name: string) =>
      name === 'stats_filter_options'
        ? new Promise(() => {
            /* Keep the filter options pending during restoration. */
          })
        : Promise.resolve({ data: [], error: null }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('uses the saved range and selections for every initial chart request', async () => {
    window.localStorage.setItem(
      'finance-tracker.stats-preferences.v1',
      JSON.stringify({
        period: 'custom',
        customRange: { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
        categories: ['Хліб'],
        stores: [],
      }),
    );
    openStats();
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('stats_by_month', expect.anything()));
    const calls = rpcMock.mock.calls.filter(([name]) => name !== 'stats_filter_options');
    expect(new Set(calls.map(([name]) => name)).size).toBe(6);
    for (const [, args] of calls) {
      expect(args).toMatchObject({
        p_date_from: '2026-08-01',
        p_date_to: '2026-08-31',
        p_categories: ['Хліб'],
        p_stores: [],
      });
    }
  });

  it('does not fetch charts for an incomplete saved custom period', async () => {
    window.localStorage.setItem(
      'finance-tracker.stats-preferences.v1',
      JSON.stringify({
        period: 'custom',
        customRange: { dateFrom: '2026-08-01', dateTo: '' },
      }),
    );
    openStats();
    expect(await screen.findByLabelText('З дати')).toHaveValue('2026-08-01');
    expect(rpcMock.mock.calls.map(([name]) => name)).toEqual(['stats_filter_options']);
  });

  it('opens a group, drills into families, and restores the group with browser Back', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      'finance-tracker.stats-preferences.v1',
      JSON.stringify({
        period: 'custom',
        customRange: { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      }),
    );
    rpcMock.mockImplementation((name) =>
      Promise.resolve({
        data:
          name === 'stats_filter_options'
            ? [{ categories: ['Овочі/фрукти', 'Молочка'], stores: ['Lidl', 'REWE'] }]
            : name === 'stats_by_category'
              ? [
                  { category: 'Овочі/фрукти', total_eur: 30, items_count: 3 },
                  { category: 'Молочка', total_eur: 10, items_count: 1 },
                ]
              : [],
        error: null,
      }),
    );
    const router = openStats();
    await user.click(await screen.findByRole('button', { name: 'Продукти →' }));
    expect(await screen.findByRole('heading', { name: 'Продукти' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Сімейство' })).getByText('50%'),
    ).toBeInTheDocument();
    expect(screen.getByText('Без визначеного сімейства')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Овочі/фрукти →' }));
    expect(await screen.findByRole('heading', { name: 'Овочі/фрукти' })).toBeInTheDocument();
    const familyTable = screen.getByRole('table', { name: 'Сімейство' });
    expect(within(familyTable).getByText('66,7%')).toBeInTheDocument();
    expect(within(familyTable).queryByText('Без визначеного сімейства')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('table', { name: 'Магазин' })).getByText('REWE'),
    ).toBeInTheDocument();
    expect(detailMock).toHaveBeenLastCalledWith(
      { dateFrom: '2026-08-01', dateTo: '2026-08-31' },
      { categories: ['Овочі/фрукти'] },
      true,
    );
    act(() => {
      router.history.back();
    });
    expect(await screen.findByRole('heading', { name: 'Продукти' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Уся статистика' }));
    expect(await screen.findByRole('heading', { name: 'По групах категорій' })).toBeInTheDocument();
    expect(screen.getByLabelText('З дати')).toHaveValue('2026-08-01');
  });

  it('opens a direct category URL and preserves saved store and category restrictions', async () => {
    window.localStorage.setItem(
      'finance-tracker.stats-preferences.v1',
      JSON.stringify({ period: 'all-time', categories: ['Молочка'], stores: ['Lidl'] }),
    );
    openStats(`/stats?category=${encodeURIComponent('Овочі/фрукти')}`);
    expect(await screen.findByText('За вибраними фільтрами покупок немає.')).toBeInTheDocument();
    expect(detailMock).toHaveBeenLastCalledWith({}, { categories: [], stores: ['Lidl'] }, true);
    expect(rpcMock.mock.calls.map(([name]) => name)).toEqual(['stats_filter_options']);
  });
});

import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { routeTree } from '@/routeTree.gen';

type RpcResult = { data: never[]; error: null };
const rpcMock = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<RpcResult>>();

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => rpcMock(name, args) },
}));
vi.mock('@/features/auth', () => ({
  Header: () => null,
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Pie: () => null }));

function openStats() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/stats'] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('saved statistics filters on page load', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    window.localStorage.clear();
    rpcMock.mockReset();
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
});

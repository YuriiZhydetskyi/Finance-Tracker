import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { categoriesQueryOptions } from '@/features/categories/api/use-categories';
import { productsQueryOptions } from '@/features/products/api/use-products';
import { receiptsQueryOptions } from '@/features/receipts/api/use-receipts';
import { searchToFilters } from '@/features/receipts/recent-search';
import { routeTree } from '@/routeTree.gen';

const tables = vi.hoisted(() => ({ requested: [] as string[] }));

// A query-builder stand-in: every chained call returns itself and awaiting it
// yields an empty successful result.
vi.mock('@/shared/lib/supabase-client', () => {
  function builder(): unknown {
    const result = { data: [], error: null, count: 0 };
    const proxy: unknown = new Proxy(() => undefined, {
      get: (_target, property) =>
        property === 'then'
          ? (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject)
          : () => proxy,
    });
    return proxy;
  }
  return {
    supabase: {
      from: (table: string) => {
        tables.requested.push(table);
        return builder();
      },
      // The home-page packaging badge reads its count through an RPC.
      rpc: () => builder(),
    },
  };
});
vi.mock('@/features/auth', () => ({
  Header: () => null,
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));

describe('home page prefetching', () => {
  it('warms the unfiltered /recent list and the category and product lists', async () => {
    tables.requested.length = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByText('Finance Tracker');

    const recentListKey = receiptsQueryOptions(searchToFilters({})).queryKey;
    await waitFor(() => {
      expect(client.getQueryData(recentListKey)).toEqual([]);
      expect(client.getQueryData(categoriesQueryOptions.queryKey)).toEqual([]);
      expect(client.getQueryData(productsQueryOptions.queryKey)).toEqual([]);
    });
    expect(tables.requested).toEqual(
      expect.arrayContaining(['receipts', 'categories', 'products']),
    );
  });
});

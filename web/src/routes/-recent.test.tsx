import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import type { Receipt } from '@finance-tracker/domain';
import { routeTree } from '@/routeTree.gen';

type ReceiptsResult = { data: Partial<Receipt>[]; error: null };

const mocks = vi.hoisted(() => ({
  pending: [] as ((result: ReceiptsResult) => void)[],
}));

vi.mock('@/shared/lib/supabase-client', () => {
  const chain = {
    select: () => chain,
    ilike: () => chain,
    eq: () => chain,
    gte: () => chain,
    lte: () => chain,
    order: () => chain,
    abortSignal: () => chain,
    limit: () =>
      new Promise<ReceiptsResult>((resolve) => {
        mocks.pending.push(resolve);
      }),
  };
  return { supabase: { from: () => chain } };
});
vi.mock('@/features/auth', () => ({
  Header: () => null,
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
  useAppUsers: () => ({ data: [] }),
}));

function receipt(id: string, store: string): Partial<Receipt> {
  return {
    id,
    store,
    date: '2026-09-01',
    time: null,
    currency: 'EUR',
    total_eur: 12.5,
    total_orig: 12.5,
    note: null,
    store_address: null,
  };
}

async function resolveNext(data: Partial<Receipt>[]) {
  await act(async () => {
    mocks.pending.shift()?.({ data, error: null });
    await Promise.resolve();
  });
}

async function openRecent() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/recent'] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByText('Останні чеки');
  return router;
}

describe('/recent while the filters change', () => {
  beforeEach(() => {
    mocks.pending.length = 0;
  });

  it('dims the previous list instead of blanking it, then shows the new result', async () => {
    const router = await openRecent();
    await resolveNext([receipt('r1', 'Lidl')]);
    expect(await screen.findByText('Lidl')).toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'false');

    await act(async () => {
      await router.navigate({ to: '/recent', search: { q: 'Aldi' } });
    });

    expect(screen.getByText('Lidl')).toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true');

    await resolveNext([receipt('r2', 'Aldi')]);

    expect(await screen.findByText('Aldi')).toBeInTheDocument();
    expect(screen.queryByText('Lidl')).not.toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'false');
  });

  it('does not report "no receipts" from a stale empty result while the new filter loads', async () => {
    const router = await openRecent();
    await resolveNext([]);
    expect(await screen.findByText('Поки що порожньо.')).toBeInTheDocument();

    await act(async () => {
      await router.navigate({ to: '/recent', search: { q: 'Aldi' } });
    });

    expect(screen.getByText('Завантажую...')).toBeInTheDocument();
    expect(screen.queryByText('Поки що порожньо.')).not.toBeInTheDocument();
    expect(screen.queryByText('Нічого не знайдено.')).not.toBeInTheDocument();

    await resolveNext([receipt('r2', 'Aldi')]);

    expect(await screen.findByText('Aldi')).toBeInTheDocument();
    expect(screen.queryByText('Завантажую...')).not.toBeInTheDocument();
  });
});

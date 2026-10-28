import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { routeTree } from '@/routeTree.gen';
import type * as PackagedProducts from '@/features/packaged-products';
import type { PackagedProductListRow } from '@/features/packaged-products';

function row(id: string, name: string, review_notes: string[]): PackagedProductListRow {
  return {
    id,
    name,
    brand: null,
    barcode: null,
    category: 'Снеки',
    product_family_id: null,
    product_variant_id: null,
    is_organic: null,
    package_size: null,
    package_unit: null,
    package_count: null,
    serving_size: null,
    nutrition_basis: null,
    energy_kj: null,
    energy_kcal: null,
    fat_g: null,
    saturated_fat_g: null,
    carbohydrate_g: null,
    sugars_g: null,
    fibre_g: null,
    protein_g: null,
    salt_g: null,
    nutri_score: null,
    allergens: [],
    allergen_traces: [],
    ingredients_text: null,
    notes: null,
    review_notes,
    import_source: 'manual-json',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    photos_count: 1,
    store_labels_count: 0,
  };
}

const PRODUCTS = [
  row('01JAAAAAAAAAAAAAAAAAAAAAAA', 'Чистий товар', []),
  row('01JBBBBBBBBBBBBBBBBBBBBBBB', 'Сумнівний товар', ['Штрихкод розмитий']),
  row('01JCCCCCCCCCCCCCCCCCCCCCCC', 'Ще один сумнівний', ['Немає звороту', 'Смак під питанням']),
];

const queue = vi.hoisted(() => ({
  rows: [] as unknown[],
  summary: { total_count: 0, recent_count: 0 },
  candidateCalls: [] as { query?: string; lastPurchasedSince?: string | undefined }[],
}));

vi.mock('@/shared/lib/supabase-client', () => ({ supabase: {} }));
vi.mock('@/features/auth', () => ({
  Header: () => null,
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
  useAppUsers: () => ({ data: ['me@example.com'] }),
  useCurrentUser: () => ({ data: { email: 'me@example.com' } }),
}));
vi.mock('@/features/categories', () => ({
  useCategories: () => ({ isSuccess: true, isPending: false, isError: false }),
  useCategoryNames: () => ['Снеки'],
}));
vi.mock('@/features/products/api/use-products', () => ({
  useProductTaxonomy: () => ({
    isSuccess: true,
    isPending: false,
    isError: false,
    data: { families: [], variants: [] },
  }),
}));
vi.mock('@/features/packaged-products', async (importOriginal) => {
  const actual = await importOriginal<typeof PackagedProducts>();
  const idle = { isPending: false, isError: false, mutate: vi.fn(), mutateAsync: vi.fn() };
  return {
    ...actual,
    usePackagedProducts: () => ({
      data: PRODUCTS,
      isSuccess: true,
      isPending: false,
      isError: false,
    }),
    usePackagingCandidates: (filters: {
      query?: string;
      lastPurchasedSince?: string | undefined;
    }) => {
      queue.candidateCalls.push(filters);
      return { data: queue.rows, isPending: false, isError: false, isPlaceholderData: false };
    },
    usePackagingQueueSummary: () => ({ data: queue.summary }),
    useSavePackagedProductsMutation: () => idle,
    useLinkStoreProductMutation: () => idle,
    useSkipPackagingMutation: () => idle,
  };
});

// The names also sit in the closed link dialog, so query the visible catalogue cards.
const findCard = (name: string) => screen.findByRole('link', { name: new RegExp(name) });
const queryCard = (name: string) => screen.queryByRole('link', { name: new RegExp(name) });

async function openCatalogue(url: string) {
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
  await screen.findByRole('heading', { name: 'Пакований товар' });
  return router;
}

describe('/packaged-products catalogue review filter', () => {
  const catalogue = [...PRODUCTS];
  afterEach(() => PRODUCTS.splice(0, PRODUCTS.length, ...catalogue));

  it('lists every card and counts those that need a check', async () => {
    await openCatalogue('/packaged-products?tab=catalogue');
    expect(await findCard('Чистий товар')).toBeInTheDocument();
    expect(queryCard('Сумнівний товар')).toBeInTheDocument();
    expect(screen.getByLabelText('Лише потрібна перевірка (2)')).not.toBeChecked();
    expect(screen.getAllByText(/Потрібна перевірка/)).toHaveLength(2);
  });

  it('shows only flagged cards when the filter is on, and keeps the choice in the URL', async () => {
    const router = await openCatalogue('/packaged-products?tab=catalogue');
    await findCard('Чистий товар');

    fireEvent.click(screen.getByLabelText('Лише потрібна перевірка (2)'));

    await waitFor(() => expect(queryCard('Чистий товар')).not.toBeInTheDocument());
    expect(queryCard('Сумнівний товар')).toBeInTheDocument();
    expect(queryCard('Ще один сумнівний')).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({ tab: 'catalogue', review: true });
    expect(router.history.canGoBack()).toBe(false);
  });

  it('restores the filter from the URL and combines it with the text search', async () => {
    await openCatalogue('/packaged-products?tab=catalogue&review=true&q=ще');
    expect(await findCard('Ще один сумнівний')).toBeInTheDocument();
    expect(queryCard('Сумнівний товар')).not.toBeInTheDocument();
    expect(queryCard('Чистий товар')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Лише потрібна перевірка (2)')).toBeChecked();
  });

  it('turning the filter off removes it from the URL', async () => {
    const router = await openCatalogue('/packaged-products?tab=catalogue&review=true');
    await findCard('Сумнівний товар');

    fireEvent.click(screen.getByLabelText('Лише потрібна перевірка (2)'));

    await waitFor(() => expect(queryCard('Чистий товар')).toBeInTheDocument());
    expect(router.state.location.search).not.toHaveProperty('review');
  });

  it('ignores a malformed review param instead of failing the route', async () => {
    await openCatalogue('/packaged-products?tab=catalogue&review=maybe');
    expect(await findCard('Чистий товар')).toBeInTheDocument();
    expect(screen.getByLabelText('Лише потрібна перевірка (2)')).not.toBeChecked();
  });

  it('offers the filter only on the catalogue tab', async () => {
    const router = await openCatalogue('/packaged-products?tab=queue');
    expect(screen.queryByLabelText(/Лише потрібна перевірка/)).not.toBeInTheDocument();
    await act(async () => {
      await router.navigate({ to: '/packaged-products', search: { tab: 'catalogue' } });
    });
    expect(await screen.findByLabelText('Лише потрібна перевірка (2)')).toBeInTheDocument();
  });

  it('says so when nothing needs a check', async () => {
    PRODUCTS.splice(0, PRODUCTS.length, row('01JAAAAAAAAAAAAAAAAAAAAAAA', 'Чистий товар', []));
    await openCatalogue('/packaged-products?tab=catalogue&review=true');
    expect(await screen.findByText('Карток, що потребують перевірки, немає.')).toBeInTheDocument();
  });
});

describe('/packaged-products queue recency window', () => {
  const lastCall = () => queue.candidateCalls[queue.candidateCalls.length - 1];

  beforeEach(() => {
    queue.rows = [];
    queue.summary = { total_count: 0, recent_count: 0 };
    queue.candidateCalls.length = 0;
  });

  it('opens with the last 30 days and says how many rows that hides', async () => {
    queue.summary = { total_count: 120, recent_count: 18 };
    await openCatalogue('/packaged-products?tab=queue');

    expect(await screen.findByText(/Приховано давніших: 102/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Показати всі' })).toBeInTheDocument();
    expect(lastCall()?.lastPurchasedSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('«Показати всі» lists every row, keeps the choice in the URL and offers a way back', async () => {
    queue.summary = { total_count: 120, recent_count: 18 };
    const router = await openCatalogue('/packaged-products?tab=queue');

    fireEvent.click(await screen.findByRole('button', { name: 'Показати всі' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ all: true }));
    expect(lastCall()?.lastPurchasedSince).toBeUndefined();
    expect(screen.getByText(/Показано всі позиції без картки: 120/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Лише останні 30 днів' }));

    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('all'));
    expect(lastCall()?.lastPurchasedSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await screen.findByRole('button', { name: 'Показати всі' })).toBeInTheDocument();
  });

  it('searches every row: a typed query drops the window', async () => {
    queue.summary = { total_count: 3, recent_count: 0 };
    await openCatalogue('/packaged-products?tab=queue&q=pesto');

    expect(await screen.findByText(/Пошук іде по всіх позиціях/)).toBeInTheDocument();
    expect(lastCall()).toMatchObject({ query: 'pesto', lastPurchasedSince: undefined });
    expect(screen.queryByRole('button', { name: 'Показати всі' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Приховано давніших/)).not.toBeInTheDocument();
  });

  it('points at the hidden rows when nothing was bought recently', async () => {
    queue.summary = { total_count: 40, recent_count: 0 };
    await openCatalogue('/packaged-products?tab=queue');

    expect(
      await screen.findByText(/нових позицій без картки немає. Давніші приховано/),
    ).toBeInTheDocument();
  });

  it('shows no toggle when the window hides nothing', async () => {
    queue.summary = { total_count: 7, recent_count: 7 };
    await openCatalogue('/packaged-products?tab=queue');

    expect(await screen.findByText(/куплені за останні 30 днів/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Показати всі' })).not.toBeInTheDocument();
  });
});

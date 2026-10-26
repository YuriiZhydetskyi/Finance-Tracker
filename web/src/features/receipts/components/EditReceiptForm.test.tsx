import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFormContext } from 'react-hook-form';
import type { ReactNode } from 'react';
import { makeItem, makeReceipt } from '@finance-tracker/domain';
import { UNSAVED_CHANGES_MESSAGE } from '@/shared/hooks/use-leave-guard';
import { EditReceiptForm } from './EditReceiptForm';

const mocks = vi.hoisted(() => ({
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: () => (values: unknown) => Promise.resolve({ values, errors: {} }),
}));
vi.mock('@/features/auth', () => ({
  useAppUsers: () => ({ data: ['me@example.com'] }),
  useCurrentUser: () => ({ data: { email: 'me@example.com' } }),
}));
vi.mock('@/features/categories', () => ({ useCategoryNames: () => [] }));
vi.mock('@/features/products', () => ({
  useProductNames: () => [],
  useProducts: () => ({ data: [] }),
}));
vi.mock('@/features/products/api/use-products', () => ({
  useProductTaxonomy: () => ({ data: { families: [], variants: [] } }),
}));
vi.mock('../api/use-update-receipt-mutation', () => ({
  useUpdateReceiptMutation: () => ({
    mutateAsync: mocks.updateMock,
    isPending: false,
    isError: false,
    error: null,
  }),
}));
vi.mock('../api/use-delete-receipt-mutation', () => ({
  useDeleteReceiptMutation: () => ({
    mutateAsync: mocks.deleteMock,
    isPending: false,
    isError: false,
    error: null,
  }),
}));
vi.mock('./ReceiptFormFields', () => ({
  ReceiptFormFields: function ReceiptFormFieldsStub({ actions }: { actions: ReactNode }) {
    const { register } = useFormContext();
    return (
      <div>
        <label>
          Магазин
          <input {...register('store')} />
        </label>
        {actions}
      </div>
    );
  },
}));

const receipt = makeReceipt({
  date: '2026-05-04',
  store: 'Lidl',
  currency: 'EUR',
  paid_by: 'me@example.com',
  source: 'manual',
  fx_rate_eur: 1,
  total_orig: 3,
});
const items = [
  makeItem({
    receipt_id: receipt.id,
    product_id: null,
    product_name: 'Молоко',
    category: 'Молочка',
    qty: 1,
    unit_price_orig: 3,
    consumed_by: 'shared',
    fx_rate_eur: 1,
  }),
];

function openEditForm(initialEntries: string[]) {
  const rootRoute = createRootRoute({ component: Outlet });
  const routes = [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/recent',
      component: function RecentPage() {
        return (
          <div>
            <p>Recent list</p>
            <Link to="/edit/$id" params={{ id: receipt.id }}>
              Open receipt
            </Link>
          </div>
        );
      },
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/edit/$id',
      component: () => <EditReceiptForm receipt={receipt} items={items} />,
    }),
  ];
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('EditReceiptForm leaving the page', () => {
  const confirmSpy = vi.spyOn(window, 'confirm');

  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  });

  beforeEach(() => {
    confirmSpy.mockReset();
    mocks.updateMock.mockReset();
    mocks.deleteMock.mockReset();
  });

  it('cancel returns to the filtered list the user came from', async () => {
    const user = userEvent.setup();
    const router = openEditForm(['/recent?q=Lidl', `/edit/${receipt.id}`]);

    await user.click(await screen.findByRole('button', { name: 'Скасувати' }));

    expect(await screen.findByText('Recent list')).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ q: 'Lidl' });
  });

  it('cancel falls back to /recent when the page was opened directly', async () => {
    const user = userEvent.setup();
    const router = openEditForm([`/edit/${receipt.id}`]);

    await user.click(await screen.findByRole('button', { name: 'Скасувати' }));

    expect(await screen.findByText('Recent list')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/recent');
  });

  it('asks before cancelling over unsaved edits', async () => {
    confirmSpy.mockReturnValue(false);
    const user = userEvent.setup();
    openEditForm([`/edit/${receipt.id}`]);

    await user.type(await screen.findByLabelText('Магазин'), ' City');
    await user.click(screen.getByRole('button', { name: 'Скасувати' }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE));
    expect(screen.getByLabelText('Магазин')).toHaveValue('Lidl City');
  });

  it('goes back without a prompt after deleting, even from a dirty form', async () => {
    mocks.deleteMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    openEditForm(['/recent', `/edit/${receipt.id}`]);

    await user.type(await screen.findByLabelText('Магазин'), ' City');
    await user.click(screen.getByRole('button', { name: 'Видалити' }));
    await act(async () => {
      await user.click(await screen.findByRole('button', { name: 'Так, видалити' }));
    });

    expect(await screen.findByText('Recent list')).toBeInTheDocument();
    expect(mocks.deleteMock).toHaveBeenCalledWith({ id: receipt.id });
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

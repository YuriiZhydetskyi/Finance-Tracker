import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFormContext } from 'react-hook-form';
import type { ReactNode } from 'react';
import { UNSAVED_CHANGES_MESSAGE } from '@/shared/hooks/use-leave-guard';
import { ManualReceiptForm } from './ManualReceiptForm';

const saveMock = vi.hoisted(() => vi.fn());

vi.mock('@hookform/resolvers/zod', () => ({
  zodResolver: () => (values: unknown) => Promise.resolve({ values, errors: {} }),
}));
vi.mock('@/features/auth', () => ({
  useAppUsers: () => ({ data: ['me@example.com'] }),
  useCurrentUser: () => ({ data: { email: 'me@example.com' } }),
}));
vi.mock('@/features/categories', () => ({ useCategoryNames: () => [] }));
vi.mock('@/features/products', () => ({ useProductNames: () => [] }));
vi.mock('@/features/products/api/use-products', () => ({
  useProductTaxonomy: () => ({ data: { families: [], variants: [] } }),
}));
vi.mock('../api/use-duplicate-receipts', () => ({ useDuplicateReceipts: () => ({ data: [] }) }));
vi.mock('../api/use-save-receipt-mutation', () => ({
  useSaveReceiptMutation: () => ({
    mutateAsync: saveMock,
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

function openManualForm() {
  const rootRoute = createRootRoute({ component: Outlet });
  const routes = [
    createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <p>Home</p> }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/manual',
      component: ManualReceiptForm,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/recent',
      component: () => <p>Recent</p>,
    }),
  ];
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ['/manual'] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('ManualReceiptForm leave guard', () => {
  const confirmSpy = vi.spyOn(window, 'confirm');

  beforeEach(() => {
    confirmSpy.mockReset();
    saveMock.mockReset();
  });

  it('does not ask before leaving a form nobody touched', async () => {
    const user = userEvent.setup();
    openManualForm();

    await user.click(await screen.findByRole('button', { name: 'Скасувати' }));

    expect(await screen.findByText('Home')).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('asks before cancelling a form with edits and stays when declined', async () => {
    confirmSpy.mockReturnValue(false);
    const user = userEvent.setup();
    openManualForm();

    await user.type(await screen.findByLabelText('Магазин'), 'Lidl');
    await user.click(screen.getByRole('button', { name: 'Скасувати' }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalledWith(UNSAVED_CHANGES_MESSAGE));
    expect(screen.getByLabelText('Магазин')).toHaveValue('Lidl');
  });

  it('leaves without a prompt right after a successful save, even though the form is dirty', async () => {
    saveMock.mockResolvedValue({ receipt_id: 'R1', items_count: 1 });
    const user = userEvent.setup();
    openManualForm();

    await user.type(await screen.findByLabelText('Магазин'), 'Lidl');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Зберегти' }));
    });

    expect(await screen.findByText('Recent')).toBeInTheDocument();
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

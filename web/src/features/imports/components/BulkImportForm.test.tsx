import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkImportForm } from './BulkImportForm';

const { createManualJsonBatchMock, navigateMock } = vi.hoisted(() => ({
  createManualJsonBatchMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/features/auth', () => ({
  useCurrentUser: () => ({ data: { email: 'me@example.com' } }),
  useAppUsers: () => ({ data: ['me@example.com'] }),
}));

vi.mock('@/features/categories', () => ({
  useCategories: () => ({ data: [{ name: 'Бакалія' }] }),
}));

vi.mock('@/features/products', () => ({
  useProducts: () => ({ data: [] }),
}));

// Import the dialog directly: the feature barrel also exports photo upload
// hooks, which initialise the Supabase client and are unrelated to this UI.
vi.mock('@/features/photo', async () => {
  const dialog = await import('@/features/photo/components/ManualJsonImportDialog');
  return { ManualJsonImportDialog: dialog.ManualJsonImportDialog };
});

vi.mock('../api/imports', () => ({
  useCreateImportBatch: () => ({ isPending: false, isError: false, mutateAsync: vi.fn() }),
  useCreateManualJsonImportBatch: () => ({
    isPending: false,
    isError: false,
    mutateAsync: createManualJsonBatchMock,
  }),
}));

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  }
});

beforeEach(() => {
  createManualJsonBatchMock.mockReset();
  createManualJsonBatchMock.mockResolvedValue('batch-amazon');
  navigateMock.mockReset();
});

it('parses pasted Amazon email JSON and creates a durable batch', async () => {
  const user = userEvent.setup();
  render(<BulkImportForm />);

  await user.click(screen.getByRole('button', { name: 'Вставити JSON у батч' }));
  fireEvent.change(screen.getByLabelText('JSON'), {
    target: {
      value: JSON.stringify([
        {
          order_number: '302-1234567-1234567',
          date: '2026-09-01T12:34:56Z',
          total: '25.00 EUR',
          return_info: null,
          items: [
            {
              title: 'Protein',
              quantity: 2,
              price: '12.50 EUR',
              asin: 'B012345678',
              product_link: 'https://www.amazon.de/dp/B012345678',
              image: 'https://m.media-amazon.com/images/I/example.jpg',
              category: 'Бакалія',
            },
          ],
        },
      ]),
    },
  });

  await user.click(screen.getByRole('button', { name: 'Перевірити й запустити батч' }));

  await waitFor(() =>
    expect(createManualJsonBatchMock).toHaveBeenCalledWith({
      paidBy: 'me@example.com',
      receipts: [
        expect.objectContaining({
          store: 'Amazon',
          merchant_order_id: '302-1234567-1234567',
          items: [
            expect.objectContaining({
              product_url: 'https://www.amazon.de/dp/B012345678',
              product_image_url: 'https://m.media-amazon.com/images/I/example.jpg',
            }),
          ],
        }),
      ],
    }),
  );
  expect(navigateMock).toHaveBeenCalledWith({
    to: '/imports/$id',
    params: { id: 'batch-amazon' },
  });
});

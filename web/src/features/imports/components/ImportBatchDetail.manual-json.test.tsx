import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportBatchDetail } from './ImportBatchDetail';

const { submitJsonMock, mutateMock } = vi.hoisted(() => ({
  submitJsonMock: vi.fn(),
  mutateMock: vi.fn(),
}));

vi.mock('@/features/categories', () => ({
  useCategories: () => ({ data: [{ name: 'Бакалія' }] }),
}));

vi.mock('@/features/products', () => ({
  useProducts: () => ({ data: [{ name: 'Bread' }] }),
}));

vi.mock('./ImportFilePreview', () => ({
  ImportFilePreview: () => <button type="button">Відкрити PDF</button>,
}));

vi.mock('../api/imports', () => ({
  useImportBatch: () => ({
    isLoading: false,
    isError: false,
    data: {
      batch: {
        id: 'batch-1',
        paid_by: 'payer@example.com',
        status: 'completed_with_exceptions',
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:01:00Z',
        completed_at: '2026-09-01T10:01:00Z',
        uploaded_by: 'payer@example.com',
      },
      files: [
        {
          id: 'file-review',
          batch_id: 'batch-1',
          status: 'needs_review',
          original_filename: 'receipt.pdf',
          mime_type: 'application/pdf',
          storage_path: 'user/imports/batch/receipt.pdf',
          attempts: 2,
          content_sha256: 'a'.repeat(64),
          created_at: '2026-09-01T10:00:00Z',
          updated_at: '2026-09-01T10:01:00Z',
          document_kind: 'receipt',
          duplicate_of_file_id: null,
          duplicate_receipt_id: null,
          error_message: 'Сума або кількість позицій не збігається.',
          exception_kind: 'validation',
          force_receipt: false,
          manual_json: null,
          original_size_bytes: 100,
          parsed_json: { total_orig: 1.49, article_count: 1 },
          processed_at: '2026-09-01T10:01:00Z',
          receipt_id: null,
          skip_duplicate_check: false,
        },
      ],
      attemptsByFile: {},
    },
  }),
  useRequeueImportFile: () => ({ isPending: false, mutate: mutateMock }),
  useDiscardImportFile: () => ({ isPending: false, mutate: mutateMock }),
  useResolveImportFile: () => ({ isPending: false, mutate: mutateMock }),
  useSubmitImportFileJson: () => ({ isPending: false, mutateAsync: submitJsonMock }),
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
  submitJsonMock.mockReset();
  submitJsonMock.mockResolvedValue(undefined);
  mutateMock.mockReset();
});

it('validates and submits corrected JSON for the same import file', async () => {
  const user = userEvent.setup();
  render(<ImportBatchDetail id="batch-1" />);

  await user.click(screen.getByRole('button', { name: 'Вставити виправлений JSON' }));

  expect(
    screen.getByRole('heading', { name: 'Виправлений JSON · receipt.pdf' }),
  ).toBeInTheDocument();
  expect(screen.getByText(/підсумок 1.49 · article_count 1/)).toBeInTheDocument();

  const candidate = {
    store: 'Lidl',
    store_address: null,
    date: '2026-05-25',
    time: '14:32',
    currency: 'EUR',
    total_orig: 1.49,
    total_raw_text: 'SUMME EUR 1,49',
    article_count: 1,
    article_count_raw_text: '1 Artikel',
    items: [
      {
        product_name: 'Bread',
        product_code: null,
        qty: 1,
        unit_price_orig: 1.49,
        discount_orig: 0,
        category_suggestion: 'Бакалія',
        row_kind: 'item',
        qty_evidence: 'implicit_one',
        source_ordinal: 1,
        raw_text: 'Bread 1,49',
        printed_line_total_orig: 1.49,
      },
    ],
  };
  fireEvent.change(screen.getByLabelText('JSON'), {
    target: { value: JSON.stringify(candidate) },
  });
  await user.click(screen.getByRole('button', { name: 'Перевірити й надіслати' }));

  await waitFor(() =>
    expect(submitJsonMock).toHaveBeenCalledWith({ id: 'file-review', json: candidate }),
  );
});

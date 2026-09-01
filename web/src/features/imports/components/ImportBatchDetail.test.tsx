import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportBatchDetail } from './ImportBatchDetail';

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));

vi.mock('@/shared/lib/dependencies', () => ({
  photoStorage: { getSignedUrl: vi.fn() },
}));

vi.mock('../api/imports', () => ({
  useImportBatch: () => ({
    isLoading: false,
    isError: false,
    data: {
      batch: {
        id: 'batch-1',
        paid_by: 'payer@example.com',
        status: 'completed',
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:01:00Z',
        completed_at: '2026-09-01T10:01:00Z',
        uploaded_by: 'payer@example.com',
      },
      files: [
        {
          id: 'file-1',
          batch_id: 'batch-1',
          status: 'saved',
          original_filename: 'receipt.pdf',
          mime_type: 'application/pdf',
          storage_path: 'imports/receipt.pdf',
          attempts: 1,
          content_sha256: 'abc',
          created_at: '2026-09-01T10:00:00Z',
          updated_at: '2026-09-01T10:01:00Z',
          document_kind: 'receipt',
          duplicate_of_file_id: null,
          duplicate_receipt_id: null,
          error_message: null,
          exception_kind: null,
          force_receipt: false,
          original_size_bytes: 100,
          parsed_json: null,
          processed_at: '2026-09-01T10:01:00Z',
          receipt_id: 'receipt-1',
          skip_duplicate_check: false,
        },
      ],
      attemptsByFile: {
        'file-1': [
          {
            id: 1,
            file_id: 'file-1',
            analysis_run: 1,
            delivery_attempt: 1,
            stage: 'independent_check',
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
            status: 'accepted',
            settings: {},
            started_at: '2026-09-01T10:00:00Z',
            finished_at: '2026-09-01T10:00:02Z',
            duration_ms: 2000,
            printed_total: 27.5,
            computed_total: 27.5,
            difference: 0,
            diagnosis_code: 'tax_class_as_quantity',
            public_message: 'VAT-клас було виправлено.',
            details: null,
            result_json: null,
            provider_request_id: 'request-1',
            stop_reason: 'tool_use',
            input_tokens: 100,
            output_tokens: 50,
            created_at: '2026-09-01T10:00:00Z',
          },
        ],
      },
    },
  }),
  useRequeueImportFile: () => ({ isPending: false, mutate: mutateMock }),
  useDiscardImportFile: () => ({ isPending: false, mutate: mutateMock }),
  useResolveImportFile: () => ({ isPending: false, mutate: mutateMock }),
}));

describe('ImportBatchDetail attempt history', () => {
  it('shows provider diagnostics and arithmetic for saved files', async () => {
    const user = userEvent.setup();
    render(<ImportBatchDetail id="batch-1" />);

    await user.click(screen.getByText('Усі файли'));
    await user.click(screen.getByText('receipt.pdf'));
    await user.click(screen.getByText('Історія аналізу (1)'));

    expect(screen.getByText(/Незалежна перевірка — результат прийнято/)).toBeInTheDocument();
    expect(screen.getByText(/Надруковано: 27.50 · позиції: 27.50/)).toBeInTheDocument();
    expect(screen.getByText(/VAT-клас було прочитано як кількість/)).toBeInTheDocument();
    expect(screen.getByText('VAT-клас було виправлено.')).toBeInTheDocument();
  });
});

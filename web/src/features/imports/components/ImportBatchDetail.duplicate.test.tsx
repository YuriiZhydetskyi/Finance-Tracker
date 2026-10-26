import { render, screen } from '@testing-library/react';
import { ImportBatchDetail } from './ImportBatchDetail';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
    className,
  }: {
    children: React.ReactNode;
    params: { id: string };
    className?: string;
  }) => (
    <a href={`/imports/${params.id}`} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('@/features/categories', () => ({
  useCategoryNames: () => [],
}));

vi.mock('@/features/products', () => ({
  useProductNameEntries: () => [],
}));

vi.mock('./ImportFilePreview', () => ({
  ImportFilePreview: ({ file }: { file: { storage_path: string | null } }) => (
    <p>preview:{file.storage_path ?? 'unavailable'}</p>
  ),
}));

const duplicateFile = (id: string, canonicalId: string) => ({
  id,
  batch_id: 'batch-2',
  status: 'duplicate',
  original_filename: `${id}.pdf`,
  mime_type: 'application/pdf',
  storage_path: null,
  duplicate_of_file_id: canonicalId,
  duplicate_receipt_id: null,
  error_message: null,
  exception_kind: null,
  parsed_json: null,
});

vi.mock('../api/imports', () => ({
  useImportBatch: () => ({
    isLoading: false,
    isError: false,
    data: {
      batch: { id: 'batch-2', paid_by: 'payer@example.com' },
      files: [
        duplicateFile('copy-1', 'canonical-1'),
        duplicateFile('copy-2', 'canonical-discarded'),
      ],
      attemptsByFile: {},
      canonicalFiles: {
        'canonical-1': {
          id: 'canonical-1',
          batch_id: 'batch-1',
          original_filename: 'first.pdf',
          mime_type: 'application/pdf',
          storage_path: 'me/imports/batch-1/canonical-1.pdf',
          status: 'saved',
        },
        'canonical-discarded': {
          id: 'canonical-discarded',
          batch_id: 'batch-1',
          original_filename: 'gone.pdf',
          mime_type: 'application/pdf',
          storage_path: 'me/imports/batch-1/canonical-discarded.pdf',
          status: 'discarded',
        },
      },
    },
  }),
  useRequeueImportFile: () => ({ isPending: false, mutate: vi.fn() }),
  useDiscardImportFile: () => ({ isPending: false, mutate: vi.fn() }),
  useResolveImportFile: () => ({ isPending: false, mutate: vi.fn() }),
  useSubmitImportFileJson: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useResumeImportUploads: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

it('previews the canonical original for duplicates and hides it once discarded', () => {
  render(<ImportBatchDetail id="batch-2" />);

  expect(screen.getAllByText('preview:me/imports/batch-1/canonical-1.pdf').length).toBeGreaterThan(
    0,
  );
  expect(screen.getAllByRole('link', { name: 'first.pdf' })[0]).toHaveAttribute(
    'href',
    '/imports/batch-1',
  );
  expect(screen.getAllByText('preview:unavailable').length).toBeGreaterThan(0);
  expect(screen.queryByText('preview:me/imports/batch-1/canonical-discarded.pdf')).toBeNull();
});

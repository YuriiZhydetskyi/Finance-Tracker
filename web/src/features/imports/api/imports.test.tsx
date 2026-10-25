import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import {
  importBatchQueryKey,
  importBatchesQueryKey,
  useCreateManualJsonImportBatch,
  useResumeImportUploads,
  useSubmitImportFileJson,
} from './imports';

const { rpcMock, prepareFileMock, uploadToPathMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  prepareFileMock: vi.fn(),
  uploadToPathMock: vi.fn(),
}));

vi.mock('@/features/photo', () => ({
  prepareFile: prepareFileMock,
}));

vi.mock('@/shared/lib/dependencies', () => ({
  photoStorage: { uploadToPath: uploadToPathMock },
}));

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: { rpc: rpcMock },
}));

beforeEach(() => {
  rpcMock.mockReset();
  prepareFileMock.mockReset();
  uploadToPathMock.mockReset();
});

function wrapperFor(queryClient: QueryClient) {
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return Wrapper;
}

function blobWithBytes(bytes: number[]): Blob {
  const buffer = new Uint8Array(bytes).buffer;
  return {
    size: bytes.length,
    type: 'application/pdf',
    arrayBuffer: () => Promise.resolve(buffer),
  } as Blob;
}

async function sha256Of(bytes: number[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('useResumeImportUploads', () => {
  const queryClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  it('uploads and queues only files whose content matches a pending slot', async () => {
    const known = [1, 2, 3];
    const stranger = [9, 9, 9];
    prepareFileMock.mockImplementation((file: File) =>
      Promise.resolve({
        blob: blobWithBytes(file.name === 'known.pdf' ? known : stranger),
        previewUrl: null,
        mimeType: 'application/pdf',
      }),
    );
    uploadToPathMock.mockResolvedValue(undefined);
    rpcMock.mockResolvedValue({ error: null });
    const targets = [
      {
        id: 'file-1',
        original_filename: 'known.pdf',
        content_sha256: await sha256Of(known),
        storage_path: 'me/imports/batch-1/file-1.pdf',
      },
    ];
    const { result } = renderHook(() => useResumeImportUploads('batch-1'), {
      wrapper: wrapperFor(queryClient()),
    });

    let outcome: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      outcome = await result.current.mutateAsync({
        files: [new File(['a'], 'known.pdf'), new File(['b'], 'other.pdf')],
        targets,
      });
    });

    expect(outcome).toEqual({ resumed: 1, unmatched: 1 });
    expect(uploadToPathMock).toHaveBeenCalledTimes(1);
    expect(uploadToPathMock).toHaveBeenCalledWith(
      expect.anything(),
      'me/imports/batch-1/file-1.pdf',
    );
    expect(rpcMock).toHaveBeenCalledWith('queue_receipt_import_file', { p_file_id: 'file-1' });
  });

  it('retries a failed upload and treats an already stored object as uploaded', async () => {
    vi.useFakeTimers();
    try {
      const bytes = [4, 5, 6];
      prepareFileMock.mockResolvedValue({
        blob: blobWithBytes(bytes),
        previewUrl: null,
        mimeType: 'application/pdf',
      });
      uploadToPathMock
        .mockRejectedValueOnce(new Error('Photo upload failed: network down'))
        .mockRejectedValueOnce(new Error('Photo upload failed: The resource already exists'));
      rpcMock.mockResolvedValue({ error: null });
      const { result } = renderHook(() => useResumeImportUploads('batch-1'), {
        wrapper: wrapperFor(queryClient()),
      });

      const pending = act(async () => {
        await result.current.mutateAsync({
          files: [new File(['a'], 'a.pdf')],
          targets: [
            {
              id: 'file-1',
              original_filename: 'a.pdf',
              content_sha256: await sha256Of(bytes),
              storage_path: 'path.pdf',
            },
          ],
        });
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await pending;

      expect(uploadToPathMock).toHaveBeenCalledTimes(2);
      expect(rpcMock).toHaveBeenCalledWith('queue_receipt_import_file', { p_file_id: 'file-1' });
      expect(rpcMock).not.toHaveBeenCalledWith(
        'mark_receipt_import_upload_failed',
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the file failed when a hung upload times out on every attempt', async () => {
    vi.useFakeTimers();
    try {
      const bytes = [7, 8];
      prepareFileMock.mockResolvedValue({
        blob: blobWithBytes(bytes),
        previewUrl: null,
        mimeType: 'application/pdf',
      });
      uploadToPathMock.mockImplementation(() => new Promise(() => undefined));
      rpcMock.mockResolvedValue({ error: null });
      const { result } = renderHook(() => useResumeImportUploads('batch-1'), {
        wrapper: wrapperFor(queryClient()),
      });

      const pending = act(async () => {
        await result.current.mutateAsync({
          files: [new File(['a'], 'a.pdf')],
          targets: [
            {
              id: 'file-1',
              original_filename: 'a.pdf',
              content_sha256: await sha256Of(bytes),
              storage_path: 'path.pdf',
            },
          ],
        });
      });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await pending;

      expect(uploadToPathMock).toHaveBeenCalledTimes(3);
      expect(rpcMock).toHaveBeenCalledWith('mark_receipt_import_upload_failed', {
        p_file_id: 'file-1',
        p_error_message: 'Upload timed out',
      });
      expect(rpcMock).not.toHaveBeenCalledWith('queue_receipt_import_file', expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });
});

it('queues validated JSON for the selected durable import file', async () => {
  rpcMock.mockResolvedValue({ error: null });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSubmitImportFileJson('batch-1'), {
    wrapper: Wrapper,
  });
  const json = { total_orig: 1.49, items: [{ product_name: 'Bread' }] };

  await act(async () => {
    await result.current.mutateAsync({ id: 'file-1', json });
  });

  expect(rpcMock).toHaveBeenCalledWith('submit_receipt_import_json', {
    p_file_id: 'file-1',
    p_manual_json: json,
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: importBatchQueryKey('batch-1') });
});

it('creates a durable batch for already validated pasted receipts', async () => {
  rpcMock.mockResolvedValue({ error: null });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCreateManualJsonImportBatch(), { wrapper: Wrapper });
  const receipts = [
    {
      store: 'Amazon',
      date: '2026-01-16',
      currency: 'EUR',
      total_orig: 21.59,
      merchant_order_id: '303-9913583-9160360',
      items: [
        {
          product_name: 'Lubido',
          qty: 1,
          unit_price_orig: 21.59,
          category_suggestion: 'Інтимні товари',
        },
      ],
    },
  ];

  await act(async () => {
    await result.current.mutateAsync({ receipts, paidBy: 'me@example.com' });
  });

  expect(rpcMock).toHaveBeenCalledWith(
    'create_manual_receipt_import_batch',
    expect.objectContaining({
      p_paid_by: 'me@example.com',
      p_receipts: receipts,
    }),
  );
  expect(invalidate).toHaveBeenCalledWith({ queryKey: importBatchesQueryKey });
});

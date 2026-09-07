import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import {
  importBatchQueryKey,
  importBatchesQueryKey,
  useCreateManualJsonImportBatch,
  useSubmitImportFileJson,
} from './imports';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/features/photo', () => ({
  prepareFile: vi.fn(),
}));

vi.mock('@/shared/lib/dependencies', () => ({
  photoStorage: {},
}));

vi.mock('@/shared/lib/supabase-client', () => ({
  supabase: { rpc: rpcMock },
}));

beforeEach(() => {
  rpcMock.mockReset();
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

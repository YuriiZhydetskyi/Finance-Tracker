import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { importBatchQueryKey, useSubmitImportFileJson } from './imports';

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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSavePhotoReceiptMutation } from './use-save-photo-receipt-mutation';
import type { SaveReceiptInput, SaveItemInput } from '@/features/receipts';

const mutateAsyncMock = vi.fn<
  (vars: { receipt: SaveReceiptInput; items: SaveItemInput[] }) => Promise<{
    receipt_id: string;
    items_count: number;
  }>
>();
const uploadMock = vi.fn<(blob: Blob) => Promise<{ path: string; signedUrl: string }>>();
const removeMock = vi.fn<(path: string) => Promise<void>>();

// Stubbed flat — NO `vi.importActual`. The real `@/features/receipts` barrel
// transitively imports `supabase-client`, which Zod-validates env vars at
// module load and throws in CI where VITE_SUPABASE_* aren't set. The test
// only needs `useSaveReceiptMutation` at runtime; types are erased.
vi.mock('@/features/receipts', () => ({
  useSaveReceiptMutation: () => ({ mutateAsync: mutateAsyncMock }),
}));

vi.mock('@/shared/lib/dependencies', () => ({
  photoStorage: {
    upload: (blob: Blob) => uploadMock(blob),
    remove: (path: string) => removeMock(path),
    getSignedUrl: vi.fn(),
  },
}));

beforeEach(() => {
  mutateAsyncMock.mockReset();
  uploadMock.mockReset();
  removeMock.mockReset();
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const baseReceipt: Omit<SaveReceiptInput, 'photo_url'> = {
  date: '2026-05-04',
  store: 'Lidl',
  currency: 'EUR',
  paid_by: 'you@example.com',
  source: 'photo',
  note: null,
  raw_ocr_json: null,
};
const baseItems: SaveItemInput[] = [
  {
    product_id: null,
    product_name: 'Молоко',
    category: 'Молочка',
    qty: 1,
    unit_price_orig: 1.5,
    consumed_by: 'shared',
    note: null,
    wasted_qty: 0,
    discount_orig: 0,
  },
];

describe('useSavePhotoReceiptMutation', () => {
  it('uploads photo, then saves receipt with signed URL injected', async () => {
    uploadMock.mockResolvedValue({ path: 'p/2026/05/A.jpg', signedUrl: 'https://signed/A' });
    mutateAsyncMock.mockResolvedValue({ receipt_id: 'R1', items_count: 1 });

    const { result } = renderHook(() => useSavePhotoReceiptMutation(), { wrapper });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({
        receipt: baseReceipt,
        items: baseItems,
        photoBlob: new Blob(['x'], { type: 'image/jpeg' }),
      });
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(mutateAsyncMock).toHaveBeenCalledTimes(1);
    const calledVars = mutateAsyncMock.mock.calls[0]![0];
    expect(calledVars.receipt.photo_url).toBe('https://signed/A');
    expect(calledVars.items).toEqual(baseItems);
    expect(removeMock).not.toHaveBeenCalled();
    expect(returned).toEqual({ receipt_id: 'R1', items_count: 1 });
  });

  it('cleans up the orphan photo when receipt save fails', async () => {
    uploadMock.mockResolvedValue({ path: 'p/2026/05/B.jpg', signedUrl: 'https://signed/B' });
    mutateAsyncMock.mockRejectedValue(new Error('Receipt insert failed: RLS denied'));
    removeMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSavePhotoReceiptMutation(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          receipt: baseReceipt,
          items: baseItems,
          photoBlob: new Blob(['x'], { type: 'image/jpeg' }),
        }),
      ).rejects.toThrow(/RLS denied/);
    });

    expect(removeMock).toHaveBeenCalledWith('p/2026/05/B.jpg');
  });

  it('does not call save or remove when the upload itself fails', async () => {
    uploadMock.mockRejectedValue(new Error('Photo upload failed: network'));

    const { result } = renderHook(() => useSavePhotoReceiptMutation(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          receipt: baseReceipt,
          items: baseItems,
          photoBlob: new Blob(['x'], { type: 'image/jpeg' }),
        }),
      ).rejects.toThrow(/network/);
    });

    expect(mutateAsyncMock).not.toHaveBeenCalled();
    expect(removeMock).not.toHaveBeenCalled();
  });

  it('swallows the cleanup error if remove fails after a save failure', async () => {
    uploadMock.mockResolvedValue({ path: 'p/2026/05/C.jpg', signedUrl: 'https://signed/C' });
    mutateAsyncMock.mockRejectedValue(new Error('Receipt insert failed'));
    removeMock.mockRejectedValue(new Error('Storage delete failed'));

    const { result } = renderHook(() => useSavePhotoReceiptMutation(), { wrapper });

    await act(async () => {
      // Original error must surface, NOT the cleanup error.
      await expect(
        result.current.mutateAsync({
          receipt: baseReceipt,
          items: baseItems,
          photoBlob: new Blob(['x'], { type: 'image/jpeg' }),
        }),
      ).rejects.toThrow(/Receipt insert failed/);
    });

    await waitFor(() => {
      expect(removeMock).toHaveBeenCalled();
    });
  });
});

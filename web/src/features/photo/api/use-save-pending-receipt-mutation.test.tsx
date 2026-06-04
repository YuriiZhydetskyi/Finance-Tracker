import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSavePendingReceiptMutation } from './use-save-pending-receipt-mutation';
import type { SaveReceiptInput, SaveItemInput } from '@/features/receipts';

const saveMock = vi.fn<
  (vars: { receipt: SaveReceiptInput; items: SaveItemInput[] }) => Promise<{
    receipt_id: string;
    items_count: number;
  }>
>();
const deletePendingMock =
  vi.fn<(vars: { id: string; removePhotoPath?: string }) => Promise<void>>();
const getSignedUrlMock = vi.fn<(path: string) => Promise<string>>();

vi.mock('@/features/receipts', () => ({
  useSaveReceiptMutation: () => ({ mutateAsync: saveMock }),
}));

vi.mock('@/features/pending-parses', () => ({
  useDeletePendingParseMutation: () => ({ mutateAsync: deletePendingMock }),
}));

vi.mock('@/shared/lib/dependencies', () => ({
  photoStorage: {
    getSignedUrl: (path: string) => getSignedUrlMock(path),
    upload: vi.fn(),
    remove: vi.fn(),
  },
}));

beforeEach(() => {
  saveMock.mockReset();
  deletePendingMock.mockReset();
  getSignedUrlMock.mockReset();
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const baseReceipt: Omit<SaveReceiptInput, 'photo_url'> = {
  date: '2026-05-04',
  store: 'Lidl',
  currency: 'EUR',
  paid_by: 'her@example.com',
  source: 'photo',
  note: null,
  raw_ocr_json: null,
};
const baseItems: SaveItemInput[] = [];

describe('useSavePendingReceiptMutation', () => {
  it('re-signs the existing path, saves, then deletes only the queue row', async () => {
    getSignedUrlMock.mockResolvedValue('https://signed/reused');
    saveMock.mockResolvedValue({ receipt_id: 'R9', items_count: 0 });
    deletePendingMock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSavePendingReceiptMutation(), { wrapper });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({
        receipt: baseReceipt,
        items: baseItems,
        photoPath: 'her@example.com/2026/06/x.jpg',
        pendingId: 'PP-9',
      });
    });

    expect(getSignedUrlMock).toHaveBeenCalledWith('her@example.com/2026/06/x.jpg');
    const saveVars = saveMock.mock.calls[0]![0];
    expect(saveVars.receipt.photo_url).toBe('https://signed/reused');
    // Row removed without a path → photo is kept (now owned by the receipt).
    expect(deletePendingMock).toHaveBeenCalledWith({ id: 'PP-9' });
    expect(returned).toEqual({ receipt_id: 'R9', items_count: 0 });
  });

  it('leaves the queue row intact when the save fails', async () => {
    getSignedUrlMock.mockResolvedValue('https://signed/reused');
    saveMock.mockRejectedValue(new Error('Receipt insert failed: RLS denied'));

    const { result } = renderHook(() => useSavePendingReceiptMutation(), { wrapper });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          receipt: baseReceipt,
          items: baseItems,
          photoPath: 'her@example.com/2026/06/x.jpg',
          pendingId: 'PP-9',
        }),
      ).rejects.toThrow(/RLS denied/);
    });

    expect(deletePendingMock).not.toHaveBeenCalled();
  });
});

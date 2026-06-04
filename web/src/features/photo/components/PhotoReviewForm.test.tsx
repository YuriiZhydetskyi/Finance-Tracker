import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import type { ReactNode } from 'react';
import type { ParsedReceipt, PairDetectionResult } from '@finance-tracker/domain';
import { PhotoReviewForm } from './PhotoReviewForm';

type SavedReceipt = {
  receipt: {
    source: string;
    photo_url: string | null;
    store: string;
    date: string;
    time: string | null;
    store_address: string | null;
  };
  items: unknown[];
};
type SavedPhotoReceipt = SavedReceipt & { photoBlob: Blob };

const saveReceiptMock = vi.fn();
const savePhotoMock = vi.fn();
const savePendingMock = vi.fn();
const navigateMock = vi.fn();

// `@/features/receipts` barrel transitively imports supabase-client which
// validates env at module load. Replace with thin stubs that keep real
// react-hook-form behaviour (useReceiptForm uses useForm under the hood).
vi.mock('@/features/receipts', () => ({
  computeGrandTotal: () => 1.49,
  DuplicateWarningBanner: () => null,
  ReceiptFormFields: ({ actions }: { actions: ReactNode }) => <div>{actions}</div>,
  SUPPORTED_CURRENCIES: ['EUR', 'UAH', 'USD'] as const,
  useDuplicateReceipts: () => ({ data: [] }),
  useSaveReceiptMutation: () => ({
    mutateAsync: saveReceiptMock,
    isPending: false,
    isError: false,
    error: null,
  }),
  useReceiptForm: (initial: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const methods = useForm<any>({
      defaultValues: { items: [], paid_by: 'me@example.com', ...initial },
    });
    const itemsArray = useFieldArray({ control: methods.control, name: 'items' });
    return { methods, itemsArray };
  },
}));

vi.mock('@/features/auth', () => ({
  useAppUsers: () => ({ data: [{ email: 'me@example.com' }] }),
}));

vi.mock('@/features/categories', () => ({
  useCategories: () => ({ data: [{ name: 'Бакалія' }] }),
}));

vi.mock('@/features/products', () => ({
  useProducts: () => ({ data: [{ name: 'Bread' }] }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('../api/use-save-photo-receipt-mutation', () => ({
  useSavePhotoReceiptMutation: () => ({
    mutateAsync: savePhotoMock,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('../api/use-save-pending-receipt-mutation', () => ({
  useSavePendingReceiptMutation: () => ({
    mutateAsync: savePendingMock,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

beforeEach(() => {
  saveReceiptMock.mockReset();
  savePhotoMock.mockReset();
  savePendingMock.mockReset();
  navigateMock.mockReset();
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const parsedReceipt: ParsedReceipt = {
  store: 'Lidl',
  store_address: 'Hauptstr. 1',
  date: '2026-05-25',
  time: '14:32',
  currency: 'EUR',
  total_orig: 1.49,
  items: [
    {
      product_name: 'Bread',
      qty: 1,
      unit_price_orig: 1.49,
      discount_orig: 0,
      category_suggestion: 'Бакалія',
      product_code: null,
    },
  ],
};

const pairResult: PairDetectionResult = {
  items: [
    {
      product_name: 'Bread',
      qty: 1,
      unit_price_orig: 1.49,
      discount_orig: 0,
      category_suggestion: 'Бакалія',
      product_code: null,
    },
  ],
};

describe('PhotoReviewForm photoBlob branching', () => {
  it('calls saveReceipt with source="manual-json" when photoBlob is null', async () => {
    saveReceiptMock.mockResolvedValue({ receipt_id: 'R1', items_count: 1 });
    const onCancel = vi.fn();

    render(
      <PhotoReviewForm
        parsed={parsedReceipt}
        pairResult={pairResult}
        photoBlob={null}
        onCancel={onCancel}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /Зберегти/i }));

    await waitFor(() => {
      expect(saveReceiptMock).toHaveBeenCalledTimes(1);
    });
    expect(savePhotoMock).not.toHaveBeenCalled();
    const vars = saveReceiptMock.mock.calls[0]![0] as SavedReceipt;
    expect(vars.receipt).toMatchObject({
      source: 'manual-json',
      photo_url: null,
      store: 'Lidl',
      store_address: 'Hauptstr. 1',
      date: '2026-05-25',
      time: '14:32',
    });
  });

  it('calls savePhoto with source="photo" when photoBlob is provided', async () => {
    savePhotoMock.mockResolvedValue({ receipt_id: 'R2', items_count: 1 });
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const onCancel = vi.fn();

    render(
      <PhotoReviewForm
        parsed={parsedReceipt}
        pairResult={pairResult}
        photoBlob={blob}
        onCancel={onCancel}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /Зберегти/i }));

    await waitFor(() => {
      expect(savePhotoMock).toHaveBeenCalledTimes(1);
    });
    expect(saveReceiptMock).not.toHaveBeenCalled();
    const vars = savePhotoMock.mock.calls[0]![0] as SavedPhotoReceipt;
    expect(vars.receipt.source).toBe('photo');
    expect(vars.photoBlob).toBe(blob);
  });

  it('calls savePending (reuse photo, prefilled payer) when pendingParse is set', async () => {
    savePendingMock.mockResolvedValue({ receipt_id: 'R3', items_count: 1 });
    const blob = new Blob(['x'], { type: 'image/jpeg' });
    const onCancel = vi.fn();
    const onSaved = vi.fn();

    render(
      <PhotoReviewForm
        parsed={parsedReceipt}
        pairResult={pairResult}
        photoBlob={blob}
        presetPaidBy="her@example.com"
        pendingParse={{ id: 'PP-1', photoPath: 'her@example.com/2026/06/x.jpg' }}
        onCancel={onCancel}
        onSaved={onSaved}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole('button', { name: /Зберегти/i }));

    await waitFor(() => expect(savePendingMock).toHaveBeenCalledTimes(1));
    expect(savePhotoMock).not.toHaveBeenCalled();
    expect(saveReceiptMock).not.toHaveBeenCalled();
    const vars = savePendingMock.mock.calls[0]![0] as {
      receipt: { paid_by: string; source: string };
      photoPath: string;
      pendingId: string;
    };
    expect(vars).toMatchObject({
      photoPath: 'her@example.com/2026/06/x.jpg',
      pendingId: 'PP-1',
    });
    expect(vars.receipt.paid_by).toBe('her@example.com');
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('R3'));
  });
});

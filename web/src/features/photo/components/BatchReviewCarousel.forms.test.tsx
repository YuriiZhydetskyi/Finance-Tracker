import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DetectedItem, PairDetectionResult, ParsedReceipt } from '@finance-tracker/domain';
import { BatchReviewCarousel } from './BatchReviewCarousel';
import type { useBatchParser } from '../batch/use-batch-parser';
import type { BatchItem } from '../batch/types';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock('@/shared/hooks/use-leave-guard', () => ({ useLeaveGuard: vi.fn() }));
vi.mock('@/features/auth', () => ({
  useAppUsers: () => ({ data: ['me@example.com'] }),
  useCurrentUser: () => ({ data: { email: 'me@example.com' } }),
}));
vi.mock('@/features/categories', () => ({
  useCategoryNames: () => ['Бакалія', 'Алкоголь'],
  CreateCategoryDialog: () => null,
}));
vi.mock('@/features/products', () => ({ useProductNames: () => [] }));
vi.mock('@/features/products/api/use-products', () => ({
  useProductTaxonomy: () => ({ data: { families: [], variants: [] } }),
}));
vi.mock('@/features/receipts/api/use-duplicate-receipts', () => ({
  useDuplicateReceipts: () => ({ data: [] }),
}));
vi.mock('@/features/receipts/api/use-save-receipt-mutation', () => ({
  useSaveReceiptMutation: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}));
vi.mock('../api/use-save-photo-receipt-mutation', () => ({
  useSavePhotoReceiptMutation: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}));
vi.mock('../api/use-save-pending-receipt-mutation', () => ({
  useSavePendingReceiptMutation: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}));

type Handle = ReturnType<typeof useBatchParser>;

function parsedItem(id: string, store: string, productName: string): BatchItem {
  const line: DetectedItem = {
    product_name: productName,
    qty: 1,
    unit_price_orig: 2,
    discount_orig: 0,
    category_suggestion: 'Бакалія',
    product_code: null,
  };
  const parsed: ParsedReceipt = {
    store,
    date: '2026-05-04',
    currency: 'EUR',
    total_orig: 2,
    items: [line],
  };
  const pairResult: PairDetectionResult = { items: [line] };
  return {
    id,
    fileName: `${id}.jpg`,
    source: 'file',
    blob: new Blob(),
    previewUrl: null,
    paidBy: 'me@example.com',
    attempts: 0,
    status: { kind: 'parsed', parsed, pairResult },
  };
}

function batchAt(items: BatchItem[], currentIndex: number): Handle {
  return {
    state: { items, currentIndex },
    removeItem: vi.fn(),
    retryItem: vi.fn(),
    deferItem: vi.fn(),
    markSaved: vi.fn(),
    goto: vi.fn(),
    reset: vi.fn(),
  } as unknown as Handle;
}

describe('BatchReviewCarousel with real review forms', () => {
  it('keeps the unsaved edits of a card after paging to another card and back', async () => {
    const user = userEvent.setup();
    const items = [parsedItem('A', 'Lidl', 'Bread'), parsedItem('B', 'Aldi', 'Milk')];
    const { rerender } = render(<BatchReviewCarousel batch={batchAt(items, 0)} />);

    const storeInput = screen.getByLabelText('Магазин / опис');
    await user.clear(storeInput);
    await user.type(storeInput, 'Lidl Nord');
    await user.selectOptions(screen.getByLabelText('Категорія'), 'Алкоголь');

    rerender(<BatchReviewCarousel batch={batchAt(items, 1)} />);

    const [firstStore, secondStore] = screen.getAllByLabelText('Магазин / опис');
    expect(secondStore).toHaveValue('Aldi');
    expect(secondStore).toBeVisible();
    expect(firstStore).toHaveValue('Lidl Nord');
    expect(firstStore).not.toBeVisible();

    rerender(<BatchReviewCarousel batch={batchAt(items, 0)} />);

    const [restoredStore] = screen.getAllByLabelText('Магазин / опис');
    expect(restoredStore).toHaveValue('Lidl Nord');
    expect(restoredStore).toBeVisible();
    expect(screen.getAllByLabelText('Категорія')[0]).toHaveValue('Алкоголь');
  });

  it('gives every mounted form its own element ids', () => {
    const items = [parsedItem('A', 'Lidl', 'Bread'), parsedItem('B', 'Aldi', 'Milk')];
    const { rerender } = render(<BatchReviewCarousel batch={batchAt(items, 0)} />);
    rerender(<BatchReviewCarousel batch={batchAt(items, 1)} />);

    expect(screen.getAllByLabelText('Магазин / опис')).toHaveLength(2);
    const ids = Array.from(document.querySelectorAll('[id]')).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

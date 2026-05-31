import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ParsedReceipt, PairDetectionResult } from '@finance-tracker/domain';
import { BatchReviewCarousel } from './BatchReviewCarousel';
import type { useBatchParser } from '../batch/use-batch-parser';
import type { BatchItem, BatchState } from '../batch/types';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('./PhotoReviewForm', () => ({
  PhotoReviewForm: ({
    onCancel,
    onSaved,
  }: {
    onCancel: () => void;
    onSaved?: (id: string) => void;
  }) => (
    <div data-testid="review-form">
      <button type="button" onClick={onCancel}>
        review-cancel
      </button>
      <button type="button" onClick={() => onSaved?.('R-stub')}>
        review-save
      </button>
    </div>
  ),
}));

const fakeParsed: ParsedReceipt = {
  store: 'Lidl',
  date: '2026-05-04',
  currency: 'EUR',
  total_orig: 1,
  items: [],
};
const fakePairResult: PairDetectionResult = { items: [] };

type Handle = ReturnType<typeof useBatchParser>;

function makeItem(id: string, status: BatchItem['status'], attempts = 0): BatchItem {
  return {
    id,
    fileName: `${id}.jpg`,
    source: 'file',
    blob: new Blob(),
    previewUrl: `blob://${id}`,
    attempts,
    status,
  };
}

function makeBatch(
  items: BatchItem[],
  currentIndex = 0,
): {
  batch: Handle;
  spies: {
    addFiles: ReturnType<typeof vi.fn>;
    addParsedReceipt: ReturnType<typeof vi.fn>;
    retryItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
    markSaved: ReturnType<typeof vi.fn>;
    goto: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
  };
} {
  const state: BatchState = { items, currentIndex };
  const spies = {
    addFiles: vi.fn<(files: File[]) => Promise<void>>().mockResolvedValue(undefined),
    addParsedReceipt: vi.fn(),
    retryItem: vi.fn(),
    removeItem: vi.fn(),
    markSaved: vi.fn(),
    goto: vi.fn(),
    reset: vi.fn(),
  };
  return {
    batch: {
      state,
      addFiles: spies.addFiles,
      addParsedReceipt: spies.addParsedReceipt,
      retryItem: spies.retryItem,
      removeItem: spies.removeItem,
      markSaved: spies.markSaved,
      goto: spies.goto,
      reset: spies.reset,
    },
    spies,
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('BatchReviewCarousel', () => {
  it('renders queued slide with file name and remove button', () => {
    const { batch } = makeBatch([makeItem('A', { kind: 'queued' })]);
    render(<BatchReviewCarousel batch={batch} />);
    expect(screen.getByText(/Очікує черги/)).toBeInTheDocument();
  });

  it('renders parsing slide with progress message', () => {
    const { batch } = makeBatch([makeItem('A', { kind: 'parsing' })]);
    render(<BatchReviewCarousel batch={batch} />);
    expect(screen.getByText(/Розпізнаю чек/)).toBeInTheDocument();
  });

  it('renders parsed slide with the review form', () => {
    const { batch } = makeBatch([
      makeItem('A', { kind: 'parsed', parsed: fakeParsed, pairResult: fakePairResult }),
    ]);
    render(<BatchReviewCarousel batch={batch} />);
    expect(screen.getByTestId('review-form')).toBeInTheDocument();
  });

  it('renders parse-error slide with retry button while attempts < MAX', () => {
    const { batch } = makeBatch([makeItem('A', { kind: 'parse-error', message: 'boom' }, 1)]);
    render(<BatchReviewCarousel batch={batch} />);
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Спробувати ще' })).toBeInTheDocument();
  });

  it('hides retry button after attempts reach MAX', () => {
    const { batch } = makeBatch([makeItem('A', { kind: 'parse-error', message: 'final' }, 2)]);
    render(<BatchReviewCarousel batch={batch} />);
    expect(screen.queryByRole('button', { name: 'Спробувати ще' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Видалити з пачки' })).toBeInTheDocument();
  });

  it('Спробувати ще → calls retryItem with current id', async () => {
    const user = userEvent.setup();
    const { batch, spies } = makeBatch([
      makeItem('A', { kind: 'parse-error', message: 'boom' }, 1),
    ]);
    render(<BatchReviewCarousel batch={batch} />);
    await user.click(screen.getByRole('button', { name: 'Спробувати ще' }));
    expect(spies.retryItem).toHaveBeenCalledWith('A');
  });

  it('Видалити з пачки → calls removeItem with current id', async () => {
    const user = userEvent.setup();
    const { batch, spies } = makeBatch([makeItem('A', { kind: 'queued' })]);
    render(<BatchReviewCarousel batch={batch} />);
    await user.click(screen.getByRole('button', { name: 'Видалити з пачки' }));
    expect(spies.removeItem).toHaveBeenCalledWith('A');
  });

  it('PhotoReviewForm onSaved → calls markSaved with current id and receipt_id', async () => {
    const user = userEvent.setup();
    const { batch, spies } = makeBatch([
      makeItem('A', { kind: 'parsed', parsed: fakeParsed, pairResult: fakePairResult }),
    ]);
    render(<BatchReviewCarousel batch={batch} />);
    await user.click(screen.getByRole('button', { name: 'review-save' }));
    expect(spies.markSaved).toHaveBeenCalledWith('A', 'R-stub');
  });

  it('clicking a dot calls goto with that index', async () => {
    const user = userEvent.setup();
    const { batch, spies } = makeBatch(
      [
        makeItem('A', { kind: 'parsed', parsed: fakeParsed, pairResult: fakePairResult }),
        makeItem('B', { kind: 'queued' }),
        makeItem('C', { kind: 'parsing' }),
      ],
      0,
    );
    render(<BatchReviewCarousel batch={batch} />);
    const dots = screen.getAllByRole('tab');
    expect(dots).toHaveLength(3);
    await user.click(dots[2]!);
    expect(spies.goto).toHaveBeenCalledWith(2);
  });

  it('disables prev arrow at first slide and next arrow at last slide', () => {
    const { batch } = makeBatch(
      [makeItem('A', { kind: 'queued' }), makeItem('B', { kind: 'queued' })],
      0,
    );
    const { rerender } = render(<BatchReviewCarousel batch={batch} />);
    expect(screen.getByRole('button', { name: 'Попередній чек' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Наступний чек' })).not.toBeDisabled();

    const { batch: batch2 } = makeBatch(
      [makeItem('A', { kind: 'queued' }), makeItem('B', { kind: 'queued' })],
      1,
    );
    rerender(<BatchReviewCarousel batch={batch2} />);
    expect(screen.getByRole('button', { name: 'Попередній чек' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Наступний чек' })).toBeDisabled();
  });

  it('shows summary card when all items are saved', () => {
    const { batch } = makeBatch([
      makeItem('A', { kind: 'saved', receipt_id: 'R1' }),
      makeItem('B', { kind: 'saved', receipt_id: 'R2' }),
    ]);
    render(<BatchReviewCarousel batch={batch} />);
    expect(screen.getByTestId('batch-summary')).toBeInTheDocument();
    expect(screen.getByText(/Збережено 2 з 2/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Перейти до списку/ });
    expect(link).toHaveAttribute('href', '/recent');
  });

  it('reset button on summary calls reset', async () => {
    const user = userEvent.setup();
    const { batch, spies } = makeBatch([makeItem('A', { kind: 'saved', receipt_id: 'R1' })]);
    render(<BatchReviewCarousel batch={batch} />);
    await user.click(screen.getByRole('button', { name: /Додати ще пачку/ }));
    expect(spies.reset).toHaveBeenCalled();
  });

  it('auto-advances to the next non-saved item after a save (800ms)', () => {
    vi.useFakeTimers();
    const { batch, spies } = makeBatch(
      [makeItem('A', { kind: 'saved', receipt_id: 'R1' }), makeItem('B', { kind: 'queued' })],
      0,
    );
    render(<BatchReviewCarousel batch={batch} />);
    expect(spies.goto).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(spies.goto).toHaveBeenCalledWith(1);
  });

  it('does not auto-advance if no later non-saved items exist', () => {
    vi.useFakeTimers();
    const { batch, spies } = makeBatch(
      [
        makeItem('A', { kind: 'saved', receipt_id: 'R1' }),
        makeItem('B', { kind: 'saved', receipt_id: 'R2' }),
      ],
      0,
    );
    render(<BatchReviewCarousel batch={batch} />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(spies.goto).not.toHaveBeenCalled();
  });
});

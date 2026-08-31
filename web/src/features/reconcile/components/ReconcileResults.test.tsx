import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type {
  NormalizedStatementTxn,
  Receipt,
  ReconcileResult,
  ToFixEntry,
} from '@finance-tracker/domain';
import { ReconcileResults } from './ReconcileResults';

function mkReceipt(id: string, store: string, paid_by: string): Receipt {
  return {
    id,
    date: '2026-05-25',
    store,
    store_address: null,
    currency: 'EUR',
    total_orig: 10,
    fx_rate_eur: 1,
    total_eur: 10,
    paid_by,
    photo_url: null,
    photo_path: null,
    source: 'photo',
    raw_ocr_json: null,
    note: null,
    time: null,
    created_at: '2026-05-25T10:00:00Z',
    updated_at: '2026-05-25T10:00:00Z',
  };
}

function mkTxn(index: number, merchant: string | null = null): NormalizedStatementTxn {
  return {
    index,
    date: '2026-05-25',
    amount: 10,
    currency: 'EUR',
    time: null,
    merchant,
    raw: null,
    category: null,
    isRefund: false,
  };
}

function mkToFix(
  index: number,
  store: string,
  from: string,
  to: string,
  storeMatch = true,
  merchant: string | null = null,
): ToFixEntry {
  return {
    txn: mkTxn(index, merchant),
    receipt: mkReceipt(`r${index}`, store, from),
    dateGap: 0,
    score: 1000,
    confidence: 'high',
    storeMatch,
    from,
    to,
  };
}

const emptyResult: ReconcileResult = {
  toFix: [],
  alreadyCorrect: [],
  ambiguous: [],
  unmatchedStatementLines: [],
};

describe('ReconcileResults', () => {
  it('renders each proposed fix with from → to and selects store matches by default', () => {
    const result: ReconcileResult = {
      ...emptyResult,
      toFix: [
        mkToFix(0, 'Lidl', 'a@example.com', 'b@example.com'),
        mkToFix(1, 'Aldi', 'a@example.com', 'b@example.com'),
      ],
    };
    render(<ReconcileResults result={result} onApply={vi.fn()} isApplying={false} />);
    expect(screen.getByText('Lidl')).toBeInTheDocument();
    expect(screen.getByText('Aldi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Застосувати вибрані \(2\)/ })).toBeInTheDocument();
  });

  it('applies exactly the selected entries', () => {
    const onApply = vi.fn();
    const result: ReconcileResult = {
      ...emptyResult,
      toFix: [
        mkToFix(0, 'Lidl', 'a@example.com', 'b@example.com'),
        mkToFix(1, 'Aldi', 'a@example.com', 'b@example.com'),
      ],
    };
    render(<ReconcileResults result={result} onApply={onApply} isApplying={false} />);

    // Deselect the Lidl row, then apply.
    fireEvent.click(screen.getByLabelText('Виправити: Lidl'));
    expect(screen.getByRole('button', { name: /Застосувати вибрані \(1\)/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Застосувати вибрані/ }));

    expect(onApply).toHaveBeenCalledOnce();
    const applied = onApply.mock.calls[0]![0] as ToFixEntry[];
    expect(applied).toHaveLength(1);
    expect(applied[0]?.receipt.store).toBe('Aldi');
  });

  it('pre-selects store matches but leaves store mismatches unchecked', () => {
    const result: ReconcileResult = {
      ...emptyResult,
      toFix: [
        mkToFix(0, 'Lidl', 'a@example.com', 'b@example.com', true),
        mkToFix(1, 'Aldi', 'a@example.com', 'b@example.com', false),
      ],
    };
    render(<ReconcileResults result={result} onApply={vi.fn()} isApplying={false} />);
    expect(screen.getByText(/Магазин збігся \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Магазин інший — підтвердь \(1\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Виправити: Lidl')).toBeChecked();
    expect(screen.getByLabelText('Виправити: Aldi')).not.toBeChecked();
    // Each group has its own apply button counting only its selection.
    expect(screen.getByRole('button', { name: /Застосувати вибрані \(1\)/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Застосувати вибрані \(0\)/ })).toBeDisabled();
  });

  it('each group applies only its own entries', () => {
    const onApply = vi.fn();
    const result: ReconcileResult = {
      ...emptyResult,
      toFix: [
        mkToFix(0, 'Lidl', 'a@example.com', 'b@example.com', true),
        mkToFix(1, 'Aldi', 'a@example.com', 'b@example.com', false),
      ],
    };
    render(<ReconcileResults result={result} onApply={onApply} isApplying={false} />);

    fireEvent.click(screen.getByLabelText('Виправити: Aldi'));
    // Groups render matches first, mismatches second.
    const buttons = screen.getAllByRole('button', { name: /Застосувати вибрані \(1\)/ });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]!);

    expect(onApply).toHaveBeenCalledOnce();
    const applied = onApply.mock.calls[0]![0] as ToFixEntry[];
    expect(applied).toHaveLength(1);
    expect(applied[0]?.receipt.store).toBe('Aldi');
  });

  it('shows both names for a store mismatch (receipt vs statement)', () => {
    const result: ReconcileResult = {
      ...emptyResult,
      toFix: [mkToFix(0, 'Amazon', 'a@example.com', 'b@example.com', false, 'AMZN MKTP DE')],
    };
    render(<ReconcileResults result={result} onApply={vi.fn()} isApplying={false} />);
    expect(screen.getByText(/у чеку:/)).toBeInTheDocument();
    expect(screen.getByText(/у виписці:/)).toBeInTheDocument();
    expect(screen.getByText('AMZN MKTP DE')).toBeInTheDocument();
  });

  it('"Зняти всі" clears the group selection so its apply is disabled', () => {
    const result: ReconcileResult = {
      ...emptyResult,
      toFix: [mkToFix(0, 'Lidl', 'a@example.com', 'b@example.com')],
    };
    render(<ReconcileResults result={result} onApply={vi.fn()} isApplying={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Зняти всі/ }));
    expect(screen.getByRole('button', { name: /Застосувати вибрані \(0\)/ })).toBeDisabled();
    // And back: the link flips to select-all.
    fireEvent.click(screen.getByRole('button', { name: /Вибрати всі/ }));
    expect(screen.getByRole('button', { name: /Застосувати вибрані \(1\)/ })).toBeEnabled();
  });

  it('shows an empty message and informational buckets when there is nothing to fix', () => {
    const result: ReconcileResult = {
      toFix: [],
      alreadyCorrect: [
        {
          txn: mkTxn(0),
          receipt: mkReceipt('r0', 'Lidl', 'b@example.com'),
          dateGap: 0,
          score: 1000,
          confidence: 'high',
          storeMatch: true,
        },
      ],
      ambiguous: [
        {
          txn: mkTxn(1),
          candidates: [
            { receipt: mkReceipt('r1', 'Rewe', 'a@example.com'), dateGap: 0, score: 1000 },
            { receipt: mkReceipt('r2', 'Rewe', 'c@example.com'), dateGap: 0, score: 1000 },
          ],
        },
      ],
      unmatchedStatementLines: [{ txn: mkTxn(2), reason: 'no-candidate' }],
    };
    render(<ReconcileResults result={result} onApply={vi.fn()} isApplying={false} />);
    expect(screen.getByText(/Немає чеків, у яких треба змінити платника/)).toBeInTheDocument();
    expect(screen.getByText(/Неоднозначні \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Без збігу \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Вже правильні \(1\)/)).toBeInTheDocument();
  });
});

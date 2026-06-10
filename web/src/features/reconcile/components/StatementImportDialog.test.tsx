import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { NormalizedStatementTxn } from '@finance-tracker/domain';
import { StatementImportDialog } from './StatementImportDialog';

const noop = () => {
  // intentionally empty
};

// jsdom doesn't implement <dialog> showModal/close — stub as open-attribute toggles.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };
  }
});

const OWNERS = ['a@example.com', 'b@example.com'];

const validJson = JSON.stringify({
  transactions: [{ date: '2026-05-25', amount: 12.34, currency: 'EUR' }],
});

function renderDialog(overrides: Partial<Parameters<typeof StatementImportDialog>[0]> = {}) {
  const props = {
    open: true,
    owners: OWNERS,
    onClose: noop,
    onReconcile: noop,
    ...overrides,
  };
  return render(<StatementImportDialog {...props} />);
}

describe('StatementImportDialog', () => {
  it('renders the owner picker, prompt, and JSON textarea when open', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: /Завантажити виписку/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Чия це картка')).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
    expect(screen.getByLabelText('JSON')).toBeInTheDocument();
  });

  it('blocks submit and warns when no owner is selected', () => {
    const onReconcile = vi.fn();
    renderDialog({ onReconcile });
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: validJson } });
    fireEvent.click(screen.getByRole('button', { name: /Звірити/i }));
    expect(onReconcile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/чия це картка/i);
  });

  it('shows a friendly error for invalid JSON', () => {
    const onReconcile = vi.fn();
    renderDialog({ onReconcile });
    fireEvent.change(screen.getByLabelText('Чия це картка'), {
      target: { value: 'b@example.com' },
    });
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: 'not json' } });
    fireEvent.click(screen.getByRole('button', { name: /Звірити/i }));
    expect(onReconcile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Не вдалося розпарсити JSON/i);
  });

  it('reports a Zod path-prefixed error when a field is wrong', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Чия це картка'), {
      target: { value: 'b@example.com' },
    });
    // amount missing → Zod reports the amount path.
    const bad = JSON.stringify({ transactions: [{ date: '2026-05-25', currency: 'EUR' }] });
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: bad } });
    fireEvent.click(screen.getByRole('button', { name: /Звірити/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/amount/);
  });

  it('calls onReconcile with the owner and normalized transactions on valid submit', () => {
    const onReconcile = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onReconcile, onClose });
    fireEvent.change(screen.getByLabelText('Чия це картка'), {
      target: { value: 'b@example.com' },
    });
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: validJson } });
    fireEvent.click(screen.getByRole('button', { name: /Звірити/i }));

    expect(onReconcile).toHaveBeenCalledOnce();
    const call = onReconcile.mock.calls[0]!;
    const owner = call[0] as string;
    const txns = call[1] as NormalizedStatementTxn[];
    expect(owner).toBe('b@example.com');
    expect(txns).toHaveLength(1);
    expect(txns[0]).toMatchObject({ index: 0, amount: 12.34, currency: 'EUR', isRefund: false });
    expect(onClose).toHaveBeenCalledOnce();
  });

  describe('duplicate guard', () => {
    const duplicateJson = JSON.stringify({
      transactions: [
        { date: '2026-05-25', amount: 12.34, currency: 'EUR', merchant: 'Lidl' },
        { date: '2026-05-25', amount: 12.34, currency: 'EUR', merchant: 'Lidl' },
        { date: '2026-05-26', amount: 5, currency: 'EUR', merchant: 'Aldi' },
      ],
    });

    function submitWithDuplicates(onReconcile = vi.fn()) {
      renderDialog({ onReconcile });
      fireEvent.change(screen.getByLabelText('Чия це картка'), {
        target: { value: 'b@example.com' },
      });
      fireEvent.change(screen.getByLabelText('JSON'), { target: { value: duplicateJson } });
      fireEvent.click(screen.getByRole('button', { name: /Звірити/i }));
      return onReconcile;
    }

    it('first submit shows the warning instead of reconciling', () => {
      const onReconcile = submitWithDuplicates();
      expect(onReconcile).not.toHaveBeenCalled();
      expect(screen.getByText(/однакові транзакції/i)).toBeInTheDocument();
      expect(screen.getByText(/зустрічається 2 разів/)).toBeInTheDocument();
      expect(screen.getByLabelText(/це окрема покупка — залишити/)).toBeChecked();
    });

    it('second submit keeps both duplicates by default', () => {
      const onReconcile = submitWithDuplicates();
      fireEvent.click(screen.getByRole('button', { name: /Звірити/i }));

      expect(onReconcile).toHaveBeenCalledOnce();
      const txns = onReconcile.mock.calls[0]![1] as NormalizedStatementTxn[];
      expect(txns).toHaveLength(3);
    });

    it('unchecking a duplicate excludes that line from reconcile', () => {
      const onReconcile = submitWithDuplicates();
      fireEvent.click(screen.getByLabelText(/це окрема покупка — залишити/));
      fireEvent.click(screen.getByRole('button', { name: /Звірити/i }));

      expect(onReconcile).toHaveBeenCalledOnce();
      const txns = onReconcile.mock.calls[0]![1] as NormalizedStatementTxn[];
      expect(txns).toHaveLength(2);
      expect(txns.map((t) => t.index)).toEqual([0, 2]);
    });

    it('editing the JSON resets the review, so the warning shows again', () => {
      const onReconcile = submitWithDuplicates();
      // Same transactions, different text — the review must not survive an edit.
      fireEvent.change(screen.getByLabelText('JSON'), { target: { value: ` ${duplicateJson}` } });
      fireEvent.click(screen.getByRole('button', { name: /Звірити/i }));

      expect(onReconcile).not.toHaveBeenCalled();
      expect(screen.getByText(/однакові транзакції/i)).toBeInTheDocument();
    });
  });
});

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ManualJsonImportDialog } from './ManualJsonImportDialog';

const noop = () => {
  // intentionally empty
};

// jsdom doesn't implement <dialog> showModal/close. Stub them to act as
// open-attribute toggles so the component's effect runs without errors.
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

const validReceiptJson = JSON.stringify({
  store: 'Lidl',
  store_address: 'Hauptstr. 1',
  date: '2026-05-25',
  time: '14:32',
  currency: 'EUR',
  total_orig: 12.34,
  items: [
    {
      product_name: 'Bread',
      qty: 1,
      unit_price_orig: 1.49,
      discount_orig: 0,
      category_suggestion: null,
    },
  ],
});

describe('ManualJsonImportDialog', () => {
  it('renders prompt and JSON textarea when open', () => {
    render(
      <ManualJsonImportDialog
        open
        categories={['Бакалія']}
        products={[{ name: 'Bread' }]}
        onClose={noop}
        onImported={noop}
      />,
    );
    expect(screen.getByRole('heading', { name: /Вставити AI JSON/i })).toBeInTheDocument();
    expect(screen.getByLabelText('JSON')).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
  });

  it('shows a parseable error when JSON is invalid', () => {
    render(
      <ManualJsonImportDialog
        open
        categories={[]}
        products={[]}
        onClose={noop}
        onImported={noop}
      />,
    );
    const textarea = screen.getByLabelText('JSON');
    fireEvent.change(textarea, { target: { value: 'not json' } });
    fireEvent.click(screen.getByRole('button', { name: /Переглянути чек/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Не вдалося розпарсити JSON/);
  });

  it('shows a Zod path-prefixed error when JSON fails schema validation', () => {
    render(
      <ManualJsonImportDialog
        open
        categories={[]}
        products={[]}
        onClose={noop}
        onImported={noop}
      />,
    );
    // Missing required `currency`, has wrong types — Zod will report paths.
    const bad = JSON.stringify({
      store: 'Lidl',
      store_address: null,
      date: '2026-05-25',
      total_orig: 10,
      items: [],
    });
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: bad } });
    fireEvent.click(screen.getByRole('button', { name: /Переглянути чек/i }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/currency/);
    // Path-prefix format: "currency: ..."
    expect(alert.textContent).toContain('currency:');
  });

  it('calls onImported with parsed receipt on valid submit', () => {
    const onImported = vi.fn();
    const onClose = vi.fn();
    render(
      <ManualJsonImportDialog
        open
        categories={[]}
        products={[]}
        onClose={onClose}
        onImported={onImported}
      />,
    );
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: validReceiptJson } });
    fireEvent.click(screen.getByRole('button', { name: /Переглянути чек/i }));
    expect(onImported).toHaveBeenCalledOnce();
    expect(onImported.mock.calls[0]![0]).toMatchObject({
      store: 'Lidl',
      store_address: 'Hauptstr. 1',
      date: '2026-05-25',
      time: '14:32',
      currency: 'EUR',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('resets error and copyState on close but preserves jsonText', () => {
    let isOpen = true;
    const onClose = vi.fn(() => {
      isOpen = false;
    });
    const renderDialog = () => (
      <ManualJsonImportDialog
        open={isOpen}
        categories={[]}
        products={[]}
        onClose={onClose}
        onImported={noop}
      />
    );

    const { rerender } = render(renderDialog());

    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: 'invalid' } });
    fireEvent.click(screen.getByRole('button', { name: /Переглянути чек/i }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByDisplayValue('invalid')).toBeInTheDocument();

    // Real-world close path: user clicks Cancel → handleClose resets state and
    // calls onClose, which the parent uses to flip the `open` prop.
    fireEvent.click(screen.getByRole('button', { name: /Скасувати/i }));
    rerender(renderDialog());

    // Reopen: jsonText preserved, error cleared.
    isOpen = true;
    rerender(renderDialog());

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('invalid')).toBeInTheDocument();
  });

  it('calls onClose on Cancel and Close buttons', () => {
    const onClose = vi.fn();
    render(
      <ManualJsonImportDialog
        open
        categories={[]}
        products={[]}
        onClose={onClose}
        onImported={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Скасувати/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /^Закрити$/i }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('auto-resets copyState to idle after the timeout', async () => {
    vi.useFakeTimers();
    try {
      // Stub clipboard.writeText to resolve immediately.
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(
        <ManualJsonImportDialog
          open
          categories={[]}
          products={[]}
          onClose={noop}
          onImported={noop}
        />,
      );
      const copyBtn = screen.getByRole('button', { name: /Скопіювати prompt/i });
      // Trigger the async click handler and let the resolved promise settle.
      fireEvent.click(copyBtn);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByRole('button', { name: /Скопійовано/i })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByRole('button', { name: /Скопіювати prompt/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

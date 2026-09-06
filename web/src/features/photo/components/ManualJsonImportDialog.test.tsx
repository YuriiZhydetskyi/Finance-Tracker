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
  total_orig: 1.49,
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

const amazonEmailJson = JSON.stringify([
  {
    order_number: '302-1234567-1234567',
    date: '2026-09-01T12:34:56Z',
    total: '12.50 EUR',
    return_info: null,
    items: [
      {
        title: 'Amazon product',
        quantity: 1,
        price: '12.50 EUR',
        asin: 'B012345678',
        product_link: 'https://www.amazon.de/dp/B012345678',
        image: 'https://m.media-amazon.com/images/I/example.jpg',
      },
    ],
  },
]);

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
    expect(screen.getByRole('heading', { name: /Вставити JSON від AI/i })).toBeInTheDocument();
    expect(screen.getByLabelText('JSON')).toBeInTheDocument();
    const prompt = screen.getByLabelText('Prompt');
    const promptValue = (prompt as HTMLTextAreaElement).value;
    expect(promptValue).toContain('"total_orig": 1.49');
    expect(promptValue).toContain('refund for returned Pfand/Leergut');
    expect(promptValue).toContain('cancellation for a reversed item');
    expect(promptValue).toContain('total_raw_text');
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
    fireEvent.click(screen.getByRole('button', { name: /Перевірити та переглянути/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Не вдалося розпарсити JSON/);
  });

  it('restores the last durable submission for correction', () => {
    const initialJson = JSON.parse(validReceiptJson) as unknown;
    render(
      <ManualJsonImportDialog
        open
        categories={[]}
        products={[]}
        initialJson={initialJson}
        onClose={noop}
        onImported={noop}
      />,
    );

    expect(screen.getByLabelText('JSON')).toHaveValue(JSON.stringify(initialJson, null, 2));
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
    fireEvent.click(screen.getByRole('button', { name: /Перевірити та переглянути/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /Перевірити та переглянути/i }));
    expect(onImported).toHaveBeenCalledOnce();
    const importedSingle = onImported.mock.calls[0]![0] as unknown[];
    expect(importedSingle).toHaveLength(1);
    expect(importedSingle[0]).toMatchObject({
      store: 'Lidl',
      store_address: 'Hauptstr. 1',
      date: '2026-05-25',
      time: '14:32',
      currency: 'EUR',
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('imports a top-level array as multiple receipts', () => {
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
    const arrayJson = JSON.stringify([
      JSON.parse(validReceiptJson),
      { ...JSON.parse(validReceiptJson), store: 'Aldi', date: '2026-05-26' },
    ]);
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: arrayJson } });
    fireEvent.click(screen.getByRole('button', { name: /Перевірити та переглянути/i }));
    expect(onImported).toHaveBeenCalledOnce();
    const imported = onImported.mock.calls[0]![0] as { store: string }[];
    expect(imported).toHaveLength(2);
    expect(imported.map((r) => r.store)).toEqual(['Lidl', 'Aldi']);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('adapts a balanced Gmail Amazon export and reports its import summary', () => {
    const onImported = vi.fn();
    render(
      <ManualJsonImportDialog
        open
        categories={[]}
        products={[]}
        onClose={noop}
        onImported={onImported}
      />,
    );

    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: amazonEmailJson } });
    fireEvent.click(screen.getByRole('button', { name: /Перевірити та переглянути/i }));

    expect(onImported).toHaveBeenCalledOnce();
    expect(onImported).toHaveBeenCalledWith(
      [expect.objectContaining({ store: 'Amazon', merchant_order_id: '302-1234567-1234567' })],
      expect.any(Array),
      expect.stringMatching(/Amazon: підготовлено 1 замовлень/),
    );
  });

  it('blocks the whole array when one receipt is invalid and labels the bad index', () => {
    const onImported = vi.fn();
    render(
      <ManualJsonImportDialog
        open
        categories={[]}
        products={[]}
        onClose={noop}
        onImported={onImported}
      />,
    );
    const arrayJson = JSON.stringify([
      JSON.parse(validReceiptJson),
      { ...JSON.parse(validReceiptJson), currency: undefined },
    ]);
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: arrayJson } });
    fireEvent.click(screen.getByRole('button', { name: /Перевірити та переглянути/i }));
    expect(onImported).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Чек #2/);
    expect(screen.getByRole('alert')).toHaveTextContent(/currency/);
  });

  it('blocks JSON whose item sum does not match total_orig', () => {
    const onImported = vi.fn();
    render(
      <ManualJsonImportDialog
        open
        categories={[]}
        products={[]}
        onClose={noop}
        onImported={onImported}
      />,
    );
    const mismatchedTotal = JSON.stringify({
      ...JSON.parse(validReceiptJson),
      total_orig: 2,
    });
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: mismatchedTotal } });
    fireEvent.click(screen.getByRole('button', { name: /Перевірити та переглянути/i }));

    expect(onImported).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/Сума позицій/);
    expect(screen.getByRole('alert')).toHaveTextContent(/total_orig/);
  });

  it('keeps the dialog open and reports a failed durable submission', async () => {
    const onImported = vi.fn().mockRejectedValue(new Error('Не вдалося поставити JSON у чергу.'));
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
    fireEvent.click(screen.getByRole('button', { name: /Перевірити та переглянути/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не вдалося поставити JSON у чергу.',
    );
    expect(onClose).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole('button', { name: /Перевірити та переглянути/i }));
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

  it('closes when Escape is pressed', () => {
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

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormProvider, useForm } from 'react-hook-form';
import { DuplicateReceiptsWarning } from './DuplicateReceiptsWarning';
import { emptyItemRow } from '../hooks/use-receipt-form';
import type { DuplicateCandidate, DuplicateCheckInput } from '../api/use-duplicate-receipts';
import type { ManualFormValues } from '../schemas/manual-form';

const duplicatesMock = vi.hoisted(() => vi.fn());

vi.mock('../api/use-duplicate-receipts', () => ({ useDuplicateReceipts: duplicatesMock }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <a href="/edit" className={className}>
      {children}
    </a>
  ),
}));

const candidate: DuplicateCandidate = {
  id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
  store: 'Edeka',
  date: '2026-05-08',
  time: null,
  total_orig: 12,
  currency: 'EUR',
};

function Wrapper() {
  const methods = useForm<ManualFormValues>({
    defaultValues: {
      date: '2026-05-08',
      time: null,
      store: 'Edeka',
      store_address: null,
      currency: 'EUR',
      paid_by: 'mg@example.com',
      source: 'manual',
      note: null,
      photo_url: null,
      raw_ocr_json: null,
      items: [
        { ...emptyItemRow(), product_name: 'A', qty: 2, unit_price_orig: 5 },
        { ...emptyItemRow(), product_name: 'B', qty: 1, unit_price_orig: 2, discount_orig: 0 },
      ],
    },
  });
  return (
    <FormProvider {...methods}>
      <input aria-label="Магазин" {...methods.register('store')} />
      <input
        aria-label="К-сть"
        type="number"
        {...methods.register('items.0.qty', { valueAsNumber: true })}
      />
      <DuplicateReceiptsWarning />
    </FormProvider>
  );
}

function lastInput(): DuplicateCheckInput {
  const input = duplicatesMock.mock.lastCall?.[0] as DuplicateCheckInput | undefined;
  if (!input) throw new Error('useDuplicateReceipts was not called');
  return input;
}

describe('DuplicateReceiptsWarning', () => {
  beforeEach(() => {
    duplicatesMock.mockReset();
    duplicatesMock.mockReturnValue({ data: [] });
  });

  it('looks up duplicates by the store, date, time and grand total of the form', () => {
    render(<Wrapper />);
    expect(lastInput()).toEqual({
      store: 'Edeka',
      date: '2026-05-08',
      time: null,
      total_orig: 12,
    });
  });

  it('follows edits to the store and to the item amounts', async () => {
    const user = userEvent.setup();
    render(<Wrapper />);

    await user.clear(screen.getByLabelText('Магазин'));
    await user.type(screen.getByLabelText('Магазин'), 'Lidl');
    expect(lastInput().store).toBe('Lidl');

    await user.clear(screen.getByLabelText('К-сть'));
    await user.type(screen.getByLabelText('К-сть'), '3');
    expect(lastInput().total_orig).toBe(17);
  });

  it('shows the candidates and hides them after "Це новий чек"', async () => {
    duplicatesMock.mockReturnValue({ data: [candidate] });
    const user = userEvent.setup();
    render(<Wrapper />);

    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Це новий чек' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

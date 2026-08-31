import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Receipt, StatementTransaction } from '@finance-tracker/domain';
import { OrphanList, type OrphanMatch, type OrphanSelection } from './OrphanList';

function mkOrphan(id: string, over: Partial<StatementTransaction> = {}): StatementTransaction {
  return {
    id,
    date: '2026-05-25',
    time: null,
    amount_orig: 10,
    currency: 'EUR',
    merchant: 'Lidl',
    raw: null,
    paid_by: 'a@example.com',
    status: 'unmatched',
    receipt_id: null,
    suggested_category: null,
    dedup_key: `key-${id}`,
    created_at: '2026-05-25T10:00:00Z',
    updated_at: '2026-05-25T10:00:00Z',
    ...over,
  };
}

function mkReceipt(id: string, store: string): Receipt {
  return {
    id,
    date: '2026-05-25',
    store,
    store_address: null,
    currency: 'EUR',
    total_orig: 10,
    fx_rate_eur: 1,
    total_eur: 10,
    paid_by: 'a@example.com',
    photo_url: null,
    photo_path: null,
    source: 'photo',
    raw_ocr_json: null,
    note: null,
    time: null,
    created_at: '2026-05-26T10:00:00Z',
    updated_at: '2026-05-26T10:00:00Z',
  };
}

function mkMatch(receipt: Receipt, over: Partial<OrphanMatch> = {}): OrphanMatch {
  return { receipt, needsFlip: false, storeMatch: true, ...over };
}

const noop = () => {
  // intentionally empty
};

function renderList(overrides: Partial<Parameters<typeof OrphanList>[0]> = {}) {
  const props = {
    orphans: [] as StatementTransaction[],
    matches: new Map<string, OrphanMatch>(),
    onCreate: noop,
    onDismiss: noop,
    onLinkSelected: noop,
    busy: false,
    ...overrides,
  };
  return render(<OrphanList {...props} />);
}

describe('OrphanList', () => {
  it('renders nothing when there are no orphans', () => {
    const { container } = renderList();
    expect(container).toBeEmptyDOMElement();
  });

  it('pre-checks store matches and leaves mismatches unchecked', () => {
    const orphans = [mkOrphan('o1'), mkOrphan('o2', { merchant: 'AMZN MKTP' })];
    const matches = new Map([
      ['o1', mkMatch(mkReceipt('r1', 'Lidl'))],
      ['o2', mkMatch(mkReceipt('r2', 'Amazon'), { storeMatch: false })],
    ]);
    renderList({ orphans, matches });

    expect(screen.getByText(/Знайдено чек \(2\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Зв'язати: Lidl")).toBeChecked();
    expect(screen.getByLabelText("Зв'язати: Amazon")).not.toBeChecked();
    expect(screen.getByRole('button', { name: /Зв’язати вибрані \(1\)/ })).toBeEnabled();
  });

  it('shows both names for a store mismatch', () => {
    const orphans = [mkOrphan('o1', { merchant: 'AMZN MKTP' })];
    const matches = new Map([['o1', mkMatch(mkReceipt('r1', 'Amazon'), { storeMatch: false })]]);
    renderList({ orphans, matches });

    expect(screen.getByText(/у чеку:/)).toBeInTheDocument();
    expect(screen.getByText(/у виписці:/)).toBeInTheDocument();
  });

  it('links exactly the checked selections', () => {
    const onLinkSelected = vi.fn();
    const orphans = [mkOrphan('o1'), mkOrphan('o2', { merchant: 'Aldi' })];
    const matches = new Map([
      ['o1', mkMatch(mkReceipt('r1', 'Lidl'))],
      ['o2', mkMatch(mkReceipt('r2', 'Aldi'))],
    ]);
    renderList({ orphans, matches, onLinkSelected });

    fireEvent.click(screen.getByLabelText("Зв'язати: Lidl"));
    fireEvent.click(screen.getByRole('button', { name: /Зв’язати вибрані \(1\)/ }));

    expect(onLinkSelected).toHaveBeenCalledOnce();
    const selections = onLinkSelected.mock.calls[0]![0] as OrphanSelection[];
    expect(selections).toHaveLength(1);
    expect(selections[0]?.orphan.id).toBe('o2');
    expect(selections[0]?.match.receipt.id).toBe('r2');
  });

  it('"Зняти всі" empties the selection and disables the link button', () => {
    const orphans = [mkOrphan('o1')];
    const matches = new Map([['o1', mkMatch(mkReceipt('r1', 'Lidl'))]]);
    renderList({ orphans, matches });

    fireEvent.click(screen.getByRole('button', { name: /Зняти всі/ }));
    expect(screen.getByRole('button', { name: /Зв’язати вибрані \(0\)/ })).toBeDisabled();
  });

  it('keeps create/dismiss actions for orphans without a match', () => {
    const onCreate = vi.fn();
    const onDismiss = vi.fn();
    const orphans = [mkOrphan('o1')];
    renderList({ orphans, onCreate, onDismiss });

    fireEvent.click(screen.getByRole('button', { name: /Створити чек/ }));
    expect(onCreate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /Ігнорувати/ }));
    expect(onDismiss).toHaveBeenCalledWith('o1');
  });

  it('disables actions while busy', () => {
    const orphans = [mkOrphan('o1'), mkOrphan('o2')];
    const matches = new Map([['o1', mkMatch(mkReceipt('r1', 'Lidl'))]]);
    renderList({ orphans, matches, busy: true });

    expect(screen.getByRole('button', { name: /Зв’язую/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Створити чек/ })).toBeDisabled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReceiptHintsPanel } from './ReceiptHintsPanel';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children: React.ReactNode;
    to: string;
    search: { tab: string; q: string };
  }) => <a href={`${to}?tab=${search.tab}&q=${encodeURIComponent(search.q)}`}>{children}</a>,
}));

const HINT = { store: 'REWE', receipt_label: 'Originals', receipt_date: '2026-09-13' };
const OTHER = { store: 'Aldi', receipt_label: 'PRINGLES ORIG.', store_product_code: '4711' };

const linkedRow = (overrides: Record<string, unknown> = {}) => ({
  store: 'REWE',
  store_product_code: null,
  product_name: 'Originals',
  receipt_labels: ['Originals'],
  ...overrides,
});

describe('ReceiptHintsPanel', () => {
  it('lists the hints with store, printed name, code and receipt date', () => {
    render(<ReceiptHintsPanel hints={[HINT, OTHER]} linked={[]} />);

    expect(screen.getByText(/REWE · «Originals» · чек від/)).toBeInTheDocument();
    expect(screen.getByText(/Aldi · «PRINGLES ORIG\.» · код 4711/)).toBeInTheDocument();
  });

  it('only offers a search of the queue; it never links', () => {
    render(<ReceiptHintsPanel hints={[HINT]} linked={[]} />);

    expect(screen.getByRole('link', { name: 'Знайти в черзі' })).toHaveAttribute(
      'href',
      '/packaged-products?tab=queue&q=Originals',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('drops a hint once a store row it describes is linked to the card', () => {
    render(<ReceiptHintsPanel hints={[HINT, OTHER]} linked={[linkedRow()]} />);

    expect(screen.queryByText(/REWE · «Originals»/)).not.toBeInTheDocument();
    expect(screen.getByText(/Aldi · «PRINGLES ORIG\.»/)).toBeInTheDocument();
  });

  it('does not treat the same label at another store as linked', () => {
    render(<ReceiptHintsPanel hints={[HINT]} linked={[linkedRow({ store: 'Lidl' })]} />);

    expect(screen.getByText(/REWE · «Originals»/)).toBeInTheDocument();
  });

  it('renders nothing when there is nothing left to link', () => {
    const { container } = render(<ReceiptHintsPanel hints={[HINT]} linked={[linkedRow()]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing without hints', () => {
    const { container } = render(<ReceiptHintsPanel hints={[]} linked={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

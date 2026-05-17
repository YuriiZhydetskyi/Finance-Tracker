import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Receipt } from '@finance-tracker/domain';
import { ReceiptCard } from './ReceiptCard';

// TanStack Router's <Link> needs a router context. For a render-only test
// we stub it with a plain anchor that exposes the resolved href via params.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
    className,
  }: {
    children: React.ReactNode;
    to: string;
    params?: { id?: string };
    className?: string;
  }) => (
    <a href={`/edit/${params?.id ?? ''}`} className={className}>
      {children}
    </a>
  ),
}));

function makeReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
    date: '2026-05-04',
    store: 'Lidl',
    store_address: null,
    currency: 'EUR',
    total_orig: 12.5,
    fx_rate_eur: 1,
    total_eur: 12.5,
    paid_by: 'you@example.com',
    photo_url: null,
    source: 'manual',
    raw_ocr_json: null,
    note: null,
    time: null,
    created_at: '2026-05-04T10:00:00+02:00',
    updated_at: '2026-05-04T10:00:00+02:00',
    ...overrides,
  };
}

describe('ReceiptCard', () => {
  it('renders store name and EUR total', () => {
    render(<ReceiptCard receipt={makeReceipt({ store: 'Lidl', total_eur: 12.5 })} />);
    expect(screen.getByText('Lidl')).toBeInTheDocument();
    expect(screen.getByText(/12,50/)).toBeInTheDocument();
  });

  it('links to /edit/:id', () => {
    const receipt = makeReceipt({ id: '01HZZZZZZZZZZZZZZZZZZZZZZZ' });
    const { container } = render(<ReceiptCard receipt={receipt} />);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/edit/01HZZZZZZZZZZZZZZZZZZZZZZZ');
  });

  it('shows original-currency total when not EUR', () => {
    render(
      <ReceiptCard
        receipt={makeReceipt({
          currency: 'UAH',
          total_orig: 100,
          total_eur: 2.24,
          fx_rate_eur: 0.0224,
        })}
      />,
    );
    // EUR total shown as primary
    expect(screen.getByText(/2,24/)).toBeInTheDocument();
    // UAH total in secondary line
    expect(screen.getByText(/100,00/)).toBeInTheDocument();
  });

  it('shows note when present', () => {
    render(<ReceiptCard receipt={makeReceipt({ note: 'тест' })} />);
    expect(screen.getByText(/тест/)).toBeInTheDocument();
  });

  it('renders negative totals in red', () => {
    const { container } = render(<ReceiptCard receipt={makeReceipt({ total_eur: -5 })} />);
    expect(container.querySelector('.text-red-600')).not.toBeNull();
  });

  it('shows time inline with date when present (sliced to HH:MM)', () => {
    render(<ReceiptCard receipt={makeReceipt({ time: '14:32:00' })} />);
    expect(screen.getByText(/· 14:32/)).toBeInTheDocument();
  });

  it('omits the time chip when receipt.time is null', () => {
    render(<ReceiptCard receipt={makeReceipt({ time: null })} />);
    expect(screen.queryByText(/· \d{2}:\d{2}/)).toBeNull();
  });

  it('shows store_address as a truncated second line when present', () => {
    render(<ReceiptCard receipt={makeReceipt({ store_address: 'Hauptstr. 12, München' })} />);
    expect(screen.getByText('Hauptstr. 12, München')).toBeInTheDocument();
  });

  it('omits the address line when store_address is null', () => {
    const { container } = render(<ReceiptCard receipt={makeReceipt({ store_address: null })} />);
    expect(container.querySelector('.text-slate-400')).toBeNull();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DuplicateWarningBanner } from './DuplicateWarningBanner';
import type { DuplicateCandidate } from '../api/use-duplicate-receipts';

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

const lidlCandidate: DuplicateCandidate = {
  id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
  store: 'Lidl',
  date: '2026-05-04',
  time: '14:32:00',
  total_orig: 18.5,
  currency: 'EUR',
};

describe('DuplicateWarningBanner', () => {
  it('renders nothing when candidates is empty', () => {
    const { container } = render(<DuplicateWarningBanner candidates={[]} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a single-candidate banner with link to /edit/:id', () => {
    render(<DuplicateWarningBanner candidates={[lidlCandidate]} onDismiss={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Знайдено подібний чек/)).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/edit/01HZZZZZZZZZZZZZZZZZZZZZZZ');
    // Display includes store, sliced time, and money formatted in EUR.
    expect(link.textContent).toMatch(/Lidl/);
    expect(link.textContent).toMatch(/14:32/);
    expect(link.textContent).toMatch(/18,50/);
  });

  it('renders plural copy and one link per candidate', () => {
    const second: DuplicateCandidate = { ...lidlCandidate, id: '01YYYYYYYYYYYYYYYYYYYYYYYY' };
    render(<DuplicateWarningBanner candidates={[lidlCandidate, second]} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Знайдено 2 подібні чеки/)).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('omits the time chip when candidate.time is null', () => {
    render(
      <DuplicateWarningBanner
        candidates={[{ ...lidlCandidate, time: null }]}
        onDismiss={vi.fn()}
      />,
    );
    const link = screen.getByRole('link');
    expect(link.textContent).not.toMatch(/·\s*\d{2}:\d{2}/);
  });

  it('invokes onDismiss when "Це новий чек" is clicked', () => {
    const onDismiss = vi.fn();
    render(<DuplicateWarningBanner candidates={[lidlCandidate]} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /Це новий чек/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancellationCard } from './CancellationCard';

const baseCancellation = {
  product_name: 'Pfand',
  category_suggestion: null,
  qty: 1,
  unit_price_orig: 0.25,
};

describe('CancellationCard', () => {
  it('renders product name and total in the receipt currency', () => {
    render(
      <CancellationCard
        cancellation={baseCancellation}
        index={0}
        included={false}
        onToggle={vi.fn()}
        currency="EUR"
      />,
    );
    expect(screen.getByText('Pfand')).toBeInTheDocument();
    // Total: 1 × 0.25 = 0.25 EUR (Ukrainian locale)
    expect(screen.getByText(/0,25/)).toBeInTheDocument();
  });

  it('strikes through the row when not included (default)', () => {
    const { container } = render(
      <CancellationCard
        cancellation={baseCancellation}
        index={0}
        included={false}
        onToggle={vi.fn()}
        currency="EUR"
      />,
    );
    expect(container.querySelectorAll('.line-through').length).toBeGreaterThan(0);
  });

  it('removes strikethrough when included', () => {
    const { container } = render(
      <CancellationCard
        cancellation={baseCancellation}
        index={0}
        included={true}
        onToggle={vi.fn()}
        currency="EUR"
      />,
    );
    expect(container.querySelectorAll('.line-through').length).toBe(0);
  });

  it('fires onToggle(index, true) when the checkbox is clicked while unchecked', async () => {
    const onToggle = vi.fn();
    render(
      <CancellationCard
        cancellation={baseCancellation}
        index={3}
        included={false}
        onToggle={onToggle}
        currency="EUR"
      />,
    );
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith(3, true);
  });

  it('fires onToggle(index, false) when toggling off', async () => {
    const onToggle = vi.fn();
    render(
      <CancellationCard
        cancellation={baseCancellation}
        index={3}
        included={true}
        onToggle={onToggle}
        currency="EUR"
      />,
    );
    await userEvent.click(screen.getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith(3, false);
  });
});

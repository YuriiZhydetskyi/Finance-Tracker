import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReviewFilterToggle } from './ReviewFilterToggle';

describe('ReviewFilterToggle', () => {
  it('shows the number of cards that need a check', () => {
    render(<ReviewFilterToggle checked={false} count={3} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Лише потрібна перевірка (3)')).not.toBeChecked();
  });

  it('reports the new state when toggled', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ReviewFilterToggle checked={false} count={3} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<ReviewFilterToggle checked count={3} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsFiltersPicker } from './StatsFiltersPicker';

const options = {
  categories: ['Молочка', 'Хліб'],
  stores: ['Aldi', 'Lidl'],
};

describe('StatsFiltersPicker', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('selects everything by default and supports clearing then choosing one category', async () => {
    const onChange = vi.fn();
    render(<StatsFiltersPicker options={options} isLoading={false} onChange={onChange} />);

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({}));

    fireEvent.click(screen.getAllByRole('button', { name: 'Зняти всі' })[0]!);
    expect(onChange).toHaveBeenLastCalledWith({ categories: [] });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Хліб' }));
    expect(onChange).toHaveBeenLastCalledWith({ categories: ['Хліб'] });
  });

  it('restores a saved selection when the page opens again', async () => {
    const firstOnChange = vi.fn();
    const first = render(
      <StatsFiltersPicker options={options} isLoading={false} onChange={firstOnChange} />,
    );
    await waitFor(() => expect(firstOnChange).toHaveBeenLastCalledWith({}));

    fireEvent.click(screen.getAllByRole('button', { name: 'Зняти всі' })[1]!);
    first.unmount();

    const restoredOnChange = vi.fn();
    render(<StatsFiltersPicker options={options} isLoading={false} onChange={restoredOnChange} />);

    await waitFor(() => expect(restoredOnChange).toHaveBeenLastCalledWith({ stores: [] }));
  });
});

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

  it('keeps saved filters active while options are loading', () => {
    window.localStorage.setItem(
      'finance-tracker.stats-preferences.v1',
      JSON.stringify({ categories: ['Хліб'], stores: [] }),
    );
    const onChange = vi.fn();
    const view = render(
      <StatsFiltersPicker options={{ categories: [], stores: [] }} isLoading onChange={onChange} />,
    );
    expect(onChange).toHaveBeenLastCalledWith({ categories: ['Хліб'], stores: [] });
    view.rerender(<StatsFiltersPicker options={options} isLoading={false} onChange={onChange} />);
    expect(onChange).toHaveBeenLastCalledWith({ categories: ['Хліб'], stores: [] });
  });

  it('remembers select-all for new options without changing the other filter', () => {
    const onChange = vi.fn();
    const first = render(
      <StatsFiltersPicker options={options} isLoading={false} onChange={onChange} />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Зняти всі' })[0]!);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Хліб' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Зняти всі' })[1]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Вибрати всі' })[1]!);
    first.unmount();

    render(
      <StatsFiltersPicker
        options={{ ...options, stores: [...options.stores, 'Rewe'] }}
        isLoading={false}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Rewe' })).toBeChecked();
    expect(onChange).toHaveBeenLastCalledWith({ categories: ['Хліб'] });
  });
});

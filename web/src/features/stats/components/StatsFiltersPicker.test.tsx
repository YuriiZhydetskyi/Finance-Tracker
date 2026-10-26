import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStatsFilters } from '../use-stats-preferences';
import { StatsFiltersPicker } from './StatsFiltersPicker';

const options = {
  categories: ['Молочка', 'Хліб'],
  stores: ['Aldi', 'Lidl'],
};

function Harness({
  pickerOptions = options,
  isLoading = false,
}: Readonly<{ pickerOptions?: typeof options; isLoading?: boolean }>) {
  const filters = useStatsFilters();
  return (
    <>
      <StatsFiltersPicker options={pickerOptions} isLoading={isLoading} />
      <output aria-label="Обрані фільтри">{JSON.stringify(filters)}</output>
    </>
  );
}

function selectedFilters(): unknown {
  return JSON.parse(screen.getByLabelText('Обрані фільтри').textContent);
}

describe('StatsFiltersPicker', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('selects everything by default and supports clearing then choosing one category', () => {
    render(<Harness />);

    expect(selectedFilters()).toEqual({});

    fireEvent.click(screen.getAllByRole('button', { name: 'Зняти всі' })[0]!);
    expect(selectedFilters()).toEqual({ categories: [] });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Хліб' }));
    expect(selectedFilters()).toEqual({ categories: ['Хліб'] });
  });

  it('restores a saved selection when the page opens again', () => {
    const first = render(<Harness />);
    expect(selectedFilters()).toEqual({});

    fireEvent.click(screen.getAllByRole('button', { name: 'Зняти всі' })[1]!);
    first.unmount();

    render(<Harness />);

    expect(selectedFilters()).toEqual({ stores: [] });
  });

  it('keeps saved filters active while options are loading', () => {
    window.localStorage.setItem(
      'finance-tracker.stats-preferences.v1',
      JSON.stringify({ categories: ['Хліб'], stores: [] }),
    );
    const view = render(<Harness pickerOptions={{ categories: [], stores: [] }} isLoading />);
    expect(selectedFilters()).toEqual({ categories: ['Хліб'], stores: [] });
    view.rerender(<Harness />);
    expect(selectedFilters()).toEqual({ categories: ['Хліб'], stores: [] });
  });

  it('remembers select-all for new options without changing the other filter', () => {
    const first = render(<Harness />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Зняти всі' })[0]!);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Хліб' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Зняти всі' })[1]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Вибрати всі' })[1]!);
    first.unmount();

    render(<Harness pickerOptions={{ ...options, stores: [...options.stores, 'Rewe'] }} />);
    expect(screen.getByRole('checkbox', { name: 'Rewe' })).toBeChecked();
    expect(selectedFilters()).toEqual({ categories: ['Хліб'] });
  });
});

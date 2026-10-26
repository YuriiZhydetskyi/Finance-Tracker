import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStatsDateRange } from '../use-stats-preferences';
import { StatsPeriodPicker } from './StatsPeriodPicker';

function Harness() {
  const range = useStatsDateRange();
  return (
    <>
      <StatsPeriodPicker />
      <output aria-label="Обраний діапазон">{JSON.stringify(range)}</output>
    </>
  );
}

function selectedRange(): unknown {
  return JSON.parse(screen.getByLabelText('Обраний діапазон').textContent);
}

describe('StatsPeriodPicker', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('does not request statistics until a complete custom range is selected', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Свій період' }));
    expect(selectedRange()).toBeNull();

    fireEvent.change(screen.getByLabelText('З дати'), { target: { value: '2026-08-01' } });
    expect(selectedRange()).toBeNull();

    fireEvent.change(screen.getByLabelText('По дату'), { target: { value: '2026-08-31' } });
    expect(selectedRange()).toEqual({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
  });

  it('shows an error instead of accepting an inverted custom range', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Свій період' }));
    fireEvent.change(screen.getByLabelText('З дати'), { target: { value: '2026-08-31' } });
    fireEvent.change(screen.getByLabelText('По дату'), { target: { value: '2026-08-01' } });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Початкова дата має бути не пізніше кінцевої.',
    );
    expect(selectedRange()).toBeNull();
  });

  it('restores the saved period when the page opens again', () => {
    const first = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'За весь час' }));
    expect(selectedRange()).toEqual({});
    first.unmount();

    render(<Harness />);

    expect(screen.getByRole('button', { name: 'За весь час' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(selectedRange()).toEqual({});
  });

  it('restores both custom dates and the active period after reopening', () => {
    const first = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Свій період' }));
    fireEvent.change(screen.getByLabelText('З дати'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('По дату'), { target: { value: '2026-08-31' } });
    first.unmount();

    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Свій період' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('З дати')).toHaveValue('2026-08-01');
    expect(screen.getByLabelText('По дату')).toHaveValue('2026-08-31');
    expect(selectedRange()).toEqual({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
  });

  it('keeps every mounted picker on the same period', () => {
    render(
      <>
        <StatsPeriodPicker />
        <StatsPeriodPicker />
      </>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Останній тиждень' })[0]!);

    for (const button of screen.getAllByRole('button', { name: 'Останній тиждень' })) {
      expect(button).toHaveAttribute('aria-pressed', 'true');
    }
  });
});

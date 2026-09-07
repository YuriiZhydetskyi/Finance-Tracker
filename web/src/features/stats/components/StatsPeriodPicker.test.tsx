import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsPeriodPicker } from './StatsPeriodPicker';

describe('StatsPeriodPicker', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('does not request statistics until a complete custom range is selected', () => {
    const onChange = vi.fn();
    render(<StatsPeriodPicker onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Свій період' }));
    expect(onChange).toHaveBeenLastCalledWith(null);

    fireEvent.change(screen.getByLabelText('З дати'), { target: { value: '2026-08-01' } });
    expect(onChange).toHaveBeenLastCalledWith(null);

    fireEvent.change(screen.getByLabelText('По дату'), { target: { value: '2026-08-31' } });
    expect(onChange).toHaveBeenLastCalledWith({
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    });
  });

  it('shows an error instead of accepting an inverted custom range', () => {
    const onChange = vi.fn();
    render(<StatsPeriodPicker onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Свій період' }));
    fireEvent.change(screen.getByLabelText('З дати'), { target: { value: '2026-08-31' } });
    fireEvent.change(screen.getByLabelText('По дату'), { target: { value: '2026-08-01' } });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Початкова дата має бути не пізніше кінцевої.',
    );
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('restores the saved period when the page opens again', async () => {
    const firstOnChange = vi.fn();
    const first = render(<StatsPeriodPicker onChange={firstOnChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'За весь час' }));
    expect(firstOnChange).toHaveBeenLastCalledWith({});
    first.unmount();

    const restoredOnChange = vi.fn();
    render(<StatsPeriodPicker onChange={restoredOnChange} />);

    await waitFor(() => expect(restoredOnChange).toHaveBeenLastCalledWith({}));
  });

  it('restores both custom dates and the active period after reopening', () => {
    const first = render(<StatsPeriodPicker onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Свій період' }));
    fireEvent.change(screen.getByLabelText('З дати'), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText('По дату'), { target: { value: '2026-08-31' } });
    first.unmount();

    const onChange = vi.fn();
    render(<StatsPeriodPicker onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Свій період' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('З дати')).toHaveValue('2026-08-01');
    expect(screen.getByLabelText('По дату')).toHaveValue('2026-08-31');
    expect(onChange).toHaveBeenLastCalledWith({ dateFrom: '2026-08-01', dateTo: '2026-08-31' });
  });
});

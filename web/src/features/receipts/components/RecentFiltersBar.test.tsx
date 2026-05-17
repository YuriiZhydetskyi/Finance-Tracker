import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RecentFiltersBar } from './RecentFiltersBar';
import type { RecentSearchInput } from '../recent-search';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

const PAID_BY = ['you@example.com', 'partner@example.com'];

function setup(search: RecentSearchInput = {}) {
  const activeCount = Object.values(search).filter((v) => v != null && v !== '').length;
  return render(
    <RecentFiltersBar search={search} paidByOptions={PAID_BY} activeCount={activeCount} />,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
});

describe('RecentFiltersBar — immediate writes', () => {
  it('navigates when date "from" changes', () => {
    setup();
    fireEvent.change(screen.getByLabelText('З дати'), { target: { value: '2026-05-01' } });
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/recent',
      search: { from: '2026-05-01', saved: undefined },
    });
  });

  it('navigates when paid_by select changes', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Оплатив'), {
      target: { value: 'you@example.com' },
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/recent',
      search: { paid_by: 'you@example.com', saved: undefined },
    });
  });

  it('navigates with undefined when clearing date input back to empty', () => {
    setup({ from: '2026-05-01' });
    fireEvent.change(screen.getByLabelText('З дати'), { target: { value: '' } });
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/recent',
      search: { from: undefined, saved: undefined },
    });
  });

  it('converts amount input value to number, not string', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Мін €'), { target: { value: '12.5' } });
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/recent',
      search: { min: 12.5, saved: undefined },
    });
  });

  it('strips the saved banner param when the user changes any filter', () => {
    setup({ saved: '01HZZZZZ' });
    fireEvent.change(screen.getByLabelText('Макс €'), { target: { value: '50' } });
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/recent',
      search: { saved: undefined, max: 50 },
    });
  });
});

describe('RecentFiltersBar — store text input debouncing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does NOT navigate before the debounce window elapses', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Магазин'), { target: { value: 'L' } });
    void act(() => vi.advanceTimersByTime(100));
    fireEvent.change(screen.getByLabelText('Магазин'), { target: { value: 'Li' } });
    void act(() => vi.advanceTimersByTime(100));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('navigates once after the debounce settles on the final value', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Магазин'), { target: { value: 'L' } });
    void act(() => vi.advanceTimersByTime(100));
    fireEvent.change(screen.getByLabelText('Магазин'), { target: { value: 'Lidl' } });
    void act(() => vi.advanceTimersByTime(400));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/recent',
      search: { q: 'Lidl', saved: undefined },
    });
  });

  it('clears q to undefined when the input is emptied', () => {
    setup({ q: 'Lidl' });
    fireEvent.change(screen.getByLabelText('Магазин'), { target: { value: '' } });
    void act(() => vi.advanceTimersByTime(400));
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/recent',
      search: { q: undefined, saved: undefined },
    });
  });
});

describe('RecentFiltersBar — clear all', () => {
  it('shows the counter + clear-all link only when activeCount > 0', () => {
    const { rerender } = setup({});
    expect(screen.queryByText(/Активні фільтри/)).toBeNull();
    rerender(<RecentFiltersBar search={{ q: 'Lidl' }} paidByOptions={PAID_BY} activeCount={1} />);
    expect(screen.getByText(/Активні фільтри/)).toBeInTheDocument();
  });

  it('navigates to /recent with empty search when "Очистити все" is clicked', () => {
    setup({ q: 'Lidl', from: '2026-05-01' });
    fireEvent.click(screen.getByRole('button', { name: /Очистити все/ }));
    expect(navigateMock).toHaveBeenCalledWith({ to: '/recent', search: {} });
  });
});

describe('RecentFiltersBar — paid_by options', () => {
  it('renders "Будь-хто" plus each provided email', () => {
    setup();
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Будь-хто',
      'you@example.com',
      'partner@example.com',
    ]);
  });
});

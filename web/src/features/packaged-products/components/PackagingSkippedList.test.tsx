import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SkippedPackagingProductRow } from '../types';
import { PackagingSkippedList } from './PackagingSkippedList';

function row(overrides: Partial<SkippedPackagingProductRow> = {}): SkippedPackagingProductRow {
  return {
    id: 'p1',
    name: 'Bananen',
    store: 'REWE',
    store_product_code: null,
    category: 'Овочі/фрукти',
    brand: null,
    packaging_not_applicable_reason: 'weighed',
    ...overrides,
  };
}

describe('PackagingSkippedList', () => {
  it('says so when nothing is marked', () => {
    render(<PackagingSkippedList rows={[]} onRestore={vi.fn()} />);

    expect(screen.getByText('Позицій без упаковки немає.')).toBeInTheDocument();
  });

  it('shows why each row is excluded and counts the reasons', () => {
    render(
      <PackagingSkippedList
        rows={[
          row({ id: 'a', name: 'Bananen' }),
          row({ id: 'b', name: 'Tragetasche', packaging_not_applicable_reason: 'bag' }),
          row({ id: 'c', name: 'Von Hand', packaging_not_applicable_reason: null }),
        ]}
        onRestore={vi.fn()}
      />,
    );

    expect(screen.getAllByText('вагове').length).toBeGreaterThan(0);
    expect(screen.getAllByText('пакет').length).toBeGreaterThan(0);
    expect(screen.getAllByText('позначено вручну').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Повернути в чергу' })).toHaveLength(3);
  });

  it('puts a single row back into the queue', () => {
    const onRestore = vi.fn();
    render(
      <PackagingSkippedList
        rows={[row({ id: 'a' }), row({ id: 'b', name: 'Tragetasche' })]}
        onRestore={onRestore}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Повернути в чергу' })[1]!);

    expect(onRestore).toHaveBeenCalledExactlyOnceWith(['b']);
  });

  it('undoes the whole rule only after a confirmation, and never touches hand-made flags', () => {
    const onRestore = vi.fn();
    render(
      <PackagingSkippedList
        rows={[
          row({ id: 'a' }),
          row({ id: 'b', packaging_not_applicable_reason: 'service' }),
          row({ id: 'c', packaging_not_applicable_reason: null }),
        ]}
        onRestore={onRestore}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Повернути в чергу всі, позначені правилом (2)' }),
    );
    expect(onRestore).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Так, повернути 2 у чергу' }));
    expect(onRestore).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
  });

  it('lets the confirmation be cancelled', () => {
    const onRestore = vi.fn();
    render(<PackagingSkippedList rows={[row()]} onRestore={onRestore} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Повернути в чергу всі, позначені правилом (1)' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));

    expect(
      screen.getByRole('button', { name: 'Повернути в чергу всі, позначені правилом (1)' }),
    ).toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('offers no bulk undo when every flag was set by hand', () => {
    render(
      <PackagingSkippedList
        rows={[row({ packaging_not_applicable_reason: null })]}
        onRestore={vi.fn()}
      />,
    );

    expect(screen.queryByText(/позначені правилом/)).not.toBeInTheDocument();
  });
});

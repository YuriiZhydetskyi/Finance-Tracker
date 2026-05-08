import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';
import { ItemRow } from './ItemRow';
import type { ItemFormValues, ManualFormValues } from '../schemas/manual-form';

function makeItem(overrides: Partial<ItemFormValues> = {}): ItemFormValues {
  return {
    product_id: null,
    product_name: 'Test Product',
    category: 'Бакалія',
    qty: 1,
    unit_price_orig: 5,
    consumed_by: 'shared',
    note: null,
    wasted_qty: 0,
    discount_orig: 0,
    ...overrides,
  };
}

function Wrapper({ item }: { item: ItemFormValues }) {
  const methods = useForm<ManualFormValues>({
    defaultValues: {
      date: '2026-05-08',
      store: 'Edeka',
      currency: 'EUR',
      paid_by: 'mg@example.com',
      source: 'photo',
      note: null,
      photo_url: null,
      raw_ocr_json: null,
      items: [item],
    },
  });
  return (
    <FormProvider {...methods}>
      <ItemRow index={0} categories={['Бакалія', 'Алкоголь']} onRemove={vi.fn()} />
    </FormProvider>
  );
}

function getInput(container: HTMLElement, field: string): HTMLInputElement {
  const el = container.querySelector(`[name="items.0.${field}"]`);
  if (!(el instanceof HTMLInputElement)) {
    throw new Error(`Input items.0.${field} not found`);
  }
  return el;
}

describe('ItemRow — pair_marker visual treatment', () => {
  describe('no marker (normal)', () => {
    it('does not render either badge and shows single-line footer', () => {
      render(<Wrapper item={makeItem()} />);
      expect(screen.queryByText(/Пробито випадково/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Знижка · автоматично/)).not.toBeInTheDocument();
      expect(screen.getByText(/Рядок:/)).toBeInTheDocument();
    });

    it('does not disable input fields', () => {
      const { container } = render(<Wrapper item={makeItem()} />);
      expect(getInput(container, 'qty').disabled).toBe(false);
      expect(getInput(container, 'unit_price_orig').disabled).toBe(false);
      expect(getInput(container, 'discount_orig').disabled).toBe(false);
    });
  });

  describe('cancelled marker', () => {
    it('renders the "Пробито випадково" badge', () => {
      render(
        <Wrapper
          item={makeItem({
            unit_price_orig: 0,
            discount_orig: 0,
            pair_marker: { kind: 'cancelled' },
          })}
        />,
      );
      expect(screen.getByText(/Пробито випадково · автоматично згруповано/)).toBeInTheDocument();
    });

    it('disables qty / price / discount / wasted_qty inputs', () => {
      const { container } = render(
        <Wrapper
          item={makeItem({
            unit_price_orig: 0,
            discount_orig: 0,
            pair_marker: { kind: 'cancelled' },
          })}
        />,
      );
      expect(getInput(container, 'qty').disabled).toBe(true);
      expect(getInput(container, 'unit_price_orig').disabled).toBe(true);
      expect(getInput(container, 'discount_orig').disabled).toBe(true);
      expect(getInput(container, 'wasted_qty').disabled).toBe(true);
    });

    it('footer shows €0 row total', () => {
      render(
        <Wrapper
          item={makeItem({
            qty: 1,
            unit_price_orig: 0,
            discount_orig: 0,
            pair_marker: { kind: 'cancelled' },
          })}
        />,
      );
      // Ukrainian locale renders 0 as "0,00 €"
      expect(screen.getByText(/Рядок:.*0,00/)).toBeInTheDocument();
    });
  });

  describe('discount-merged marker', () => {
    it('renders the "Знижка · автоматично згруповано" badge', () => {
      render(
        <Wrapper
          item={makeItem({
            qty: 1,
            unit_price_orig: 5,
            discount_orig: 1.5,
            pair_marker: { kind: 'discount-merged' },
          })}
        />,
      );
      expect(screen.getByText(/Знижка · автоматично згруповано/)).toBeInTheDocument();
    });

    it('shows original / discount / final breakdown in footer', () => {
      render(
        <Wrapper
          item={makeItem({
            qty: 1,
            unit_price_orig: 5,
            discount_orig: 1.5,
            pair_marker: { kind: 'discount-merged' },
          })}
        />,
      );
      expect(screen.getByText(/Оригінал:/)).toBeInTheDocument();
      // The Знижка label inside the footer breakdown (distinct from the input label).
      expect(screen.getByText(/^Знижка:/)).toBeInTheDocument();
      expect(screen.getByText(/−.*1,50/)).toBeInTheDocument();
      expect(screen.getByText(/Фінал:/)).toBeInTheDocument();
      expect(screen.getByText(/3,50/)).toBeInTheDocument();
    });

    it('keeps inputs editable (user can adjust the auto-merged values)', () => {
      const { container } = render(
        <Wrapper
          item={makeItem({
            qty: 1,
            unit_price_orig: 5,
            discount_orig: 1.5,
            pair_marker: { kind: 'discount-merged' },
          })}
        />,
      );
      expect(getInput(container, 'qty').disabled).toBe(false);
      expect(getInput(container, 'unit_price_orig').disabled).toBe(false);
      expect(getInput(container, 'discount_orig').disabled).toBe(false);
    });
  });
});

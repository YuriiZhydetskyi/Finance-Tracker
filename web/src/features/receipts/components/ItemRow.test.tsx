import { Profiler } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFieldArray, useForm, FormProvider } from 'react-hook-form';
import { ItemRow } from './ItemRow';
import { SummaryFooter } from './SummaryFooter';
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

function Wrapper({
  item,
  extraItems = [],
}: {
  item: ItemFormValues;
  extraItems?: ItemFormValues[];
}) {
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
      items: [item, ...extraItems],
    },
  });
  return (
    <FormProvider {...methods}>
      {methods.getValues('items').map((_, index) => (
        <ItemRow
          key={index}
          index={index}
          categories={['Бакалія', 'Алкоголь']}
          onRemove={vi.fn()}
        />
      ))}
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
    it('does not render any badge and shows single-line footer', () => {
      render(<Wrapper item={makeItem()} />);
      expect(screen.queryByText(/Пробито випадково/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Знижка · /)).not.toBeInTheDocument();
      expect(screen.queryByText(/🔗/)).not.toBeInTheDocument();
      expect(screen.getByText(/Рядок:/)).toBeInTheDocument();
    });

    it('shows safe Amazon thumbnail and product link from structured metadata', () => {
      render(
        <Wrapper
          item={makeItem({
            product_url: 'https://www.amazon.de/dp/B012345678',
            product_image_url: 'https://m.media-amazon.com/images/I/example.jpg',
          })}
        />,
      );

      const image = document.querySelector('img');
      expect(image).toHaveAttribute('src', 'https://m.media-amazon.com/images/I/example.jpg');
      expect(screen.getByRole('link', { name: 'Відкрити товар' })).toHaveAttribute(
        'href',
        'https://www.amazon.de/dp/B012345678',
      );
    });

    it('does not disable input fields', () => {
      const { container } = render(<Wrapper item={makeItem()} />);
      expect(getInput(container, 'qty').disabled).toBe(false);
      expect(getInput(container, 'unit_price_orig').disabled).toBe(false);
      expect(getInput(container, 'discount_orig').disabled).toBe(false);
    });
  });

  describe('cancelled marker (count=1)', () => {
    it('renders the "Пробито випадково · автоматично згруповано" badge', () => {
      render(
        <Wrapper
          item={makeItem({
            unit_price_orig: 0,
            discount_orig: 0,
            pair_marker: { kind: 'cancelled', count: 1 },
          })}
        />,
      );
      expect(screen.getByText(/Пробито випадково · автоматично згруповано/)).toBeInTheDocument();
    });

    it('disables qty / price / discount inputs', () => {
      const { container } = render(
        <Wrapper
          item={makeItem({
            unit_price_orig: 0,
            discount_orig: 0,
            pair_marker: { kind: 'cancelled', count: 1 },
          })}
        />,
      );
      expect(getInput(container, 'qty').disabled).toBe(true);
      expect(getInput(container, 'unit_price_orig').disabled).toBe(true);
      expect(getInput(container, 'discount_orig').disabled).toBe(true);
    });

    it('footer shows €0 row total', () => {
      render(
        <Wrapper
          item={makeItem({
            qty: 1,
            unit_price_orig: 0,
            discount_orig: 0,
            pair_marker: { kind: 'cancelled', count: 1 },
          })}
        />,
      );
      expect(screen.getByText(/Рядок:.*0,00/)).toBeInTheDocument();
    });
  });

  describe('cancelled marker with count > 1', () => {
    it('badge mentions the merged-pair count', () => {
      render(
        <Wrapper
          item={makeItem({
            qty: 2,
            unit_price_orig: 0,
            discount_orig: 0,
            pair_marker: { kind: 'cancelled', count: 2 },
          })}
        />,
      );
      expect(
        screen.getByText(/Пробито випадково · 2 однакові пари згруповано/),
      ).toBeInTheDocument();
    });
  });

  describe('discount-merged marker (count=1)', () => {
    it('renders the "Знижка · автоматично згруповано" badge', () => {
      render(
        <Wrapper
          item={makeItem({
            qty: 1,
            unit_price_orig: 5,
            discount_orig: 1.5,
            pair_marker: { kind: 'discount-merged', count: 1 },
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
            pair_marker: { kind: 'discount-merged', count: 1 },
          })}
        />,
      );
      expect(screen.getByText(/Оригінал:/)).toBeInTheDocument();
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
            pair_marker: { kind: 'discount-merged', count: 1 },
          })}
        />,
      );
      expect(getInput(container, 'qty').disabled).toBe(false);
      expect(getInput(container, 'unit_price_orig').disabled).toBe(false);
      expect(getInput(container, 'discount_orig').disabled).toBe(false);
    });
  });

  describe('saved item with discount but no marker (post-save edit view)', () => {
    it('shows the original / discount / final breakdown', () => {
      // pair_marker is UI-only and lost on save. When re-opening a saved
      // discounted item, the breakdown must still render so the user can see
      // which lines had a discount and how big it was.
      render(
        <Wrapper
          item={makeItem({
            qty: 1,
            unit_price_orig: 3.29,
            discount_orig: 1.64,
          })}
        />,
      );
      expect(screen.getByText(/Оригінал:/)).toBeInTheDocument();
      expect(screen.getByText(/^Знижка:/)).toBeInTheDocument();
      expect(screen.getByText(/−.*1,64/)).toBeInTheDocument();
      expect(screen.getByText(/Фінал:/)).toBeInTheDocument();
      expect(screen.getByText(/1,65/)).toBeInTheDocument();
    });

    it('does not render the auto-grouped badge (no marker means user kept it)', () => {
      render(
        <Wrapper
          item={makeItem({
            qty: 1,
            unit_price_orig: 3.29,
            discount_orig: 1.64,
          })}
        />,
      );
      expect(screen.queryByText(/Знижка · /)).not.toBeInTheDocument();
    });
  });

  describe('discount-merged marker with count > 1', () => {
    it('badge mentions the merged-pair count and triblock reflects summed qty', () => {
      render(
        <Wrapper
          item={makeItem({
            qty: 2,
            unit_price_orig: 5,
            discount_orig: 1,
            pair_marker: { kind: 'discount-merged', count: 2 },
          })}
        />,
      );
      expect(screen.getByText(/Знижка · 2 однакові пари згруповано/)).toBeInTheDocument();
      // Original total = 2 × 5 = 10. Discount total = 2 × 1 = 2. Final = 8.
      expect(screen.getByText(/Оригінал:.*2.*×.*5,00/)).toBeInTheDocument();
      expect(screen.getByText(/10,00/)).toBeInTheDocument();
      expect(screen.getByText(/−.*2,00/)).toBeInTheDocument();
      expect(screen.getByText(/8,00/)).toBeInTheDocument();
    });
  });

  describe('aggregated marker', () => {
    it('renders the "🔗 N рядки з чека згруповано" badge', () => {
      render(
        <Wrapper
          item={makeItem({
            qty: 4,
            unit_price_orig: 0.5,
            pair_marker: { kind: 'aggregated', count: 4 },
          })}
        />,
      );
      expect(screen.getByText(/🔗 4 рядки з чека згруповано/)).toBeInTheDocument();
    });

    it('uses subtle slate background, not amber/emerald', () => {
      const { container } = render(
        <Wrapper
          item={makeItem({
            qty: 4,
            unit_price_orig: 0.5,
            pair_marker: { kind: 'aggregated', count: 4 },
          })}
        />,
      );
      const card = container.querySelector('.bg-slate-50\\/50');
      expect(card).toBeInTheDocument();
      // Sanity: not coloured like cancelled/discount-merged.
      expect(container.querySelector('.border-amber-300')).toBeNull();
      expect(container.querySelector('.border-emerald-300')).toBeNull();
    });

    it('keeps inputs editable', () => {
      const { container } = render(
        <Wrapper
          item={makeItem({
            qty: 4,
            unit_price_orig: 0.5,
            pair_marker: { kind: 'aggregated', count: 4 },
          })}
        />,
      );
      expect(getInput(container, 'qty').disabled).toBe(false);
      expect(getInput(container, 'unit_price_orig').disabled).toBe(false);
      expect(getInput(container, 'discount_orig').disabled).toBe(false);
    });

    it('footer shows normal "Рядок:" with summed total (qty × unit_price)', () => {
      render(
        <Wrapper
          item={makeItem({
            qty: 4,
            unit_price_orig: 0.5,
            pair_marker: { kind: 'aggregated', count: 4 },
          })}
        />,
      );
      // 4 × 0.50 = 2.00 EUR.
      expect(screen.getByText(/Рядок:.*2,00/)).toBeInTheDocument();
    });
  });
});

describe('ItemRow — label association', () => {
  const FIELD_LABELS: [label: string, field: string][] = [
    ['Товар', 'product_name'],
    ['Категорія', 'category'],
    ['К-сть', 'qty'],
    ['Ціна', 'unit_price_orig'],
    ['Товар · вид', 'product_family_id'],
    ['Різновид', 'product_variant_id'],
    ['Бренд', 'brand'],
    ['Bio', 'is_organic'],
    ['Хто', 'consumed_by'],
    ['Знижка', 'discount_orig'],
    ['Нотатка', 'note'],
  ];

  it.each(FIELD_LABELS)('label "%s" is bound to items.0.%s', (label, field) => {
    render(<Wrapper item={makeItem()} />);
    expect(screen.getByLabelText(label)).toHaveAttribute('name', `items.0.${field}`);
  });

  it('names the store product code input without a visible label', () => {
    render(<Wrapper item={makeItem()} />);
    expect(screen.getByLabelText('Код товару')).toHaveAttribute(
      'name',
      'items.0.store_product_code',
    );
  });

  it('focuses the control when its label is clicked', async () => {
    const user = userEvent.setup();
    render(<Wrapper item={makeItem()} />);

    await user.click(screen.getByText('К-сть'));

    expect(screen.getByLabelText('К-сть')).toHaveFocus();
  });

  it('keeps the control ids unique across repeated rows', () => {
    render(<Wrapper item={makeItem()} extraItems={[makeItem({ product_name: 'Second' })]} />);

    const quantities = screen.getAllByLabelText('К-сть');
    expect(quantities.map((input) => input.getAttribute('name'))).toEqual([
      'items.0.qty',
      'items.1.qty',
    ]);

    const ids = Array.from(document.querySelectorAll('[id]')).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('ItemRow — re-render isolation', () => {
  function RowsHarness({ onRender }: { onRender: (id: string) => void }) {
    const methods = useForm<ManualFormValues>({
      defaultValues: {
        date: '2026-05-08',
        store: 'Edeka',
        currency: 'EUR',
        paid_by: 'mg@example.com',
        source: 'manual',
        note: null,
        photo_url: null,
        raw_ocr_json: null,
        items: [makeItem({ product_name: 'First' }), makeItem({ product_name: 'Second' })],
      },
    });
    const { fields } = useFieldArray({ control: methods.control, name: 'items' });
    return (
      <FormProvider {...methods}>
        {fields.map((field, index) => (
          <Profiler
            key={field.id}
            id={`row-${String(index)}`}
            onRender={(id) => {
              onRender(id);
            }}
          >
            <ItemRow index={index} categories={['Бакалія']} onRemove={vi.fn()} />
          </Profiler>
        ))}
        <Profiler
          id="footer"
          onRender={(id) => {
            onRender(id);
          }}
        >
          <SummaryFooter />
        </Profiler>
      </FormProvider>
    );
  }

  async function typeInto(label: string, rowIndex: number, text: string) {
    const user = userEvent.setup();
    const input = screen.getAllByLabelText(label)[rowIndex];
    if (!input) throw new Error(`No "${label}" control in row ${String(rowIndex)}`);
    await user.clear(input);
    await user.type(input, text);
  }

  it('re-renders only the edited row when a non-money field changes', async () => {
    const rendered: string[] = [];
    render(<RowsHarness onRender={(id) => rendered.push(id)} />);
    rendered.length = 0;

    await typeInto('Нотатка', 0, 'abc');

    expect(new Set(rendered)).toEqual(new Set(['row-0']));
  });

  it('re-renders the edited row and the footer, not the other rows, when an amount changes', async () => {
    const rendered: string[] = [];
    render(<RowsHarness onRender={(id) => rendered.push(id)} />);
    rendered.length = 0;

    await typeInto('К-сть', 1, '2');

    expect(new Set(rendered)).toEqual(new Set(['row-1', 'footer']));
    expect(screen.getByText('Загалом').nextElementSibling).toHaveTextContent('15,00');
  });
});

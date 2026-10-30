import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PackagedProductsList } from './PackagedProductsList';
import type { PackagedProductListRow } from '../api/use-packaged-products';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    params,
    className,
  }: {
    children: React.ReactNode;
    params: { id: string };
    className?: string;
  }) => (
    <a href={`/packaged-products/${params.id}`} className={className}>
      {children}
    </a>
  ),
}));

function row(overrides: Partial<PackagedProductListRow>): PackagedProductListRow {
  return {
    id: '01JAAAAAAAAAAAAAAAAAAAAAAA',
    name: 'Pringles Original 165 г',
    brand: 'Pringles',
    barcode: '5053990101658',
    category: 'Снеки',
    product_family_id: null,
    product_variant_id: null,
    is_organic: null,
    package_size: 165,
    package_unit: 'g',
    package_count: null,
    serving_size: null,
    nutrition_basis: 'per_100_g',
    energy_kj: null,
    energy_kcal: 523,
    fat_g: null,
    saturated_fat_g: null,
    carbohydrate_g: null,
    sugars_g: null,
    fibre_g: null,
    protein_g: null,
    salt_g: null,
    nutri_score: null,
    allergens: [],
    allergen_traces: [],
    ingredients_text: null,
    notes: null,
    review_notes: [],
    attributes: {},
    import_source: 'manual-json',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    photos_count: 2,
    store_labels_count: 1,
    ...overrides,
  };
}

describe('PackagedProductsList', () => {
  it('marks only the cards that need a manual check', () => {
    render(
      <PackagedProductsList
        products={[
          row({ id: '01JAAAAAAAAAAAAAAAAAAAAAAA', name: 'Чистий товар' }),
          row({
            id: '01JBBBBBBBBBBBBBBBBBBBBBBB',
            name: 'Сумнівний товар',
            review_notes: ['Штрихкод розмитий'],
          }),
        ]}
      />,
    );
    const badges = screen.getAllByText(/Потрібна перевірка/);
    expect(badges).toHaveLength(1);
    const flagged = screen.getByText('Сумнівний товар').closest('li');
    expect(flagged).toContainElement(badges[0] ?? null);
    expect(screen.getByText('Чистий товар').closest('li')).not.toHaveTextContent(
      'Потрібна перевірка',
    );
  });

  it('shows how many reasons there are and lists them on hover', () => {
    render(<PackagedProductsList products={[row({ review_notes: ['Перша', 'Друга'] })]} />);
    const badge = screen.getByText('Потрібна перевірка · 2');
    expect(badge).toHaveAttribute('title', 'Перша\nДруга');
  });

  it('keeps the card usable: it is still a link to the detail page', () => {
    render(<PackagedProductsList products={[row({ review_notes: ['Перша'] })]} />);
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/packaged-products/01JAAAAAAAAAAAAAAAAAAAAAAA',
    );
  });

  it('shows the supplied empty message', () => {
    render(
      <PackagedProductsList products={[]} emptyMessage="Карток, що потребують перевірки, немає." />,
    );
    expect(screen.getByText('Карток, що потребують перевірки, немає.')).toBeInTheDocument();
  });
});

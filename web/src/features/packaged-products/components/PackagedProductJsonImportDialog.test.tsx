import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  PackagedProductJsonImportDialog,
  type ImportedPackagedProduct,
} from './PackagedProductJsonImportDialog';
import type { PackagedProductListRow } from '../api/use-packaged-products';
import type { PackagingCandidateRow } from '../types';

// jsdom does not implement the native <dialog> element.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.open = false;
  });
});

const CATEGORIES = ['Снеки', 'Молочка', 'Хімія/гігієна'];
const TAXONOMY = {
  families: [{ id: 'chips', name_uk: 'Чіпси', name_de: 'Chips' }],
  variants: [
    { id: 'potato_chips', family_id: 'chips', name_uk: 'Картопляні', name_de: 'Kartoffelchips' },
  ],
};

const VALID_JSON = JSON.stringify({
  name: 'Pringles Original 165 г',
  brand: 'Pringles',
  barcode: '5053990101658',
  category: 'Снеки',
  product_family_id: 'chips',
  product_variant_id: 'potato_chips',
  package_size: 165,
  package_unit: 'g',
  nutrition_basis: 'per_100_g',
  energy_kcal: 523,
  fat_g: 31,
  saturated_fat_g: 2.9,
  carbohydrate_g: 52,
  sugars_g: 2.4,
  protein_g: 4.2,
  salt_g: 1.3,
  allergens: ['gluten'],
  ingredients_text: 'Kartoffelflocken',
});

function existingRow(overrides: Partial<PackagedProductListRow>): PackagedProductListRow {
  return {
    id: '01JAAAAAAAAAAAAAAAAAAAAAAA',
    name: 'Наявна картка',
    barcode: null,
    brand: null,
    category: 'Снеки',
    product_family_id: null,
    product_variant_id: null,
    is_organic: null,
    package_size: null,
    package_unit: null,
    package_count: null,
    serving_size: null,
    nutrition_basis: null,
    energy_kj: null,
    energy_kcal: null,
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
    import_source: 'manual',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    photos_count: 0,
    store_labels_count: 0,
    ...overrides,
  };
}

const CANDIDATE: PackagingCandidateRow = {
  product_id: '01JBBBBBBBBBBBBBBBBBBBBBBB',
  product_name: 'Original',
  store: 'REWE',
  store_product_code: null,
  category: 'Снеки',
  brand: 'Pringles',
  is_organic: null,
  product_family_id: null,
  product_variant_id: null,
  receipt_labels: ['Original', 'ORIGINAL 165G'],
  purchases_count: 3,
  total_qty: 3,
  total_eur: 8.97,
  last_purchased_on: '2026-09-01',
  last_price_orig: 2.99,
  last_currency: 'EUR',
  group_key: 'pringles original',
  group_purchases_count: 3,
};

function renderDialog(
  overrides: Partial<Parameters<typeof PackagedProductJsonImportDialog>[0]> = {},
) {
  const onImported = vi.fn<(products: ImportedPackagedProduct[]) => void>();
  render(
    <PackagedProductJsonImportDialog
      open
      categories={CATEGORIES}
      taxonomy={TAXONOMY}
      existing={[]}
      submitting={false}
      onClose={vi.fn()}
      onImported={onImported}
      {...overrides}
    />,
  );
  return { onImported };
}

function promptText(): string {
  return screen.getByLabelText<HTMLTextAreaElement>('Prompt').value;
}

function paste(json: string) {
  fireEvent.change(screen.getByLabelText('JSON'), { target: { value: json } });
  fireEvent.click(screen.getByRole('button', { name: 'Перевірити та зберегти' }));
}

describe('PackagedProductJsonImportDialog', () => {
  it('accepts a valid single product', async () => {
    const { onImported } = renderDialog();
    paste(VALID_JSON);

    await vi.waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1);
    });
    const [products] = onImported.mock.calls[0] ?? [];
    expect(products?.[0]?.parsed.name).toBe('Pringles Original 165 г');
  });

  it('accepts an array of products', async () => {
    const { onImported } = renderDialog();
    const second = JSON.parse(VALID_JSON) as Record<string, unknown>;
    second.name = 'Pringles Paprika 165 г';
    second.barcode = '5449000000996';
    paste(JSON.stringify([JSON.parse(VALID_JSON), second]));

    await vi.waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1);
    });
    expect(onImported.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('blocks an unknown category and imports nothing', async () => {
    const { onImported } = renderDialog();
    const payload = JSON.parse(VALID_JSON) as Record<string, unknown>;
    payload.category = 'Вигадана';
    paste(JSON.stringify(payload));

    expect(await screen.findByRole('alert')).toHaveTextContent('Вигадана');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('blocks a barcode another card already owns', async () => {
    const { onImported } = renderDialog({
      existing: [existingRow({ barcode: '5053990101658', name: 'Стара картка' })],
    });
    paste(VALID_JSON);

    expect(await screen.findByRole('alert')).toHaveTextContent('Стара картка');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('blocks a duplicate barcode inside one paste', async () => {
    const { onImported } = renderDialog();
    paste(JSON.stringify([JSON.parse(VALID_JSON), JSON.parse(VALID_JSON)]));

    expect(await screen.findByRole('alert')).toHaveTextContent('повторюється');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('warns about a bad GTIN check digit but still imports', async () => {
    const { onImported } = renderDialog();
    const payload = JSON.parse(VALID_JSON) as Record<string, unknown>;
    payload.barcode = '5053990101659';
    paste(JSON.stringify(payload));

    await vi.waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1);
    });
  });

  it('names the receipt labels in the prompt when opened from a queue row', () => {
    renderDialog({ candidate: CANDIDATE });
    const prompt = promptText();
    expect(prompt).toContain('"Original" у REWE');
    expect(prompt).toContain('"ORIGINAL 165G" у REWE');
  });

  it('lists the allowed categories and taxonomy ids in the prompt', () => {
    renderDialog();
    const prompt = promptText();
    expect(prompt).toContain('Дозволені категорії: Снеки, Молочка, Хімія/гігієна');
    expect(prompt).toContain('chips — Чіпси');
    expect(prompt).toContain('potato_chips (сімейство chips)');
  });

  it('never tells the AI to convert a per-serving column', () => {
    renderDialog();
    expect(promptText()).toContain('НІКОЛИ не перераховуй порцію в 100 г');
  });

  it('reports unreadable JSON without throwing', async () => {
    const { onImported } = renderDialog();
    paste('{ not json');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });
});

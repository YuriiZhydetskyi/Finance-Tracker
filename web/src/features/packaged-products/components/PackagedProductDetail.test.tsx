import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PackagedProductDetail } from './PackagedProductDetail';
import type { PackagedProductRow } from '../types';

const mocks = vi.hoisted(() => ({
  product: { current: null as PackagedProductRow | null },
  hints: { current: [] as unknown[] },
  updateNotes: vi.fn(),
  updateState: { isPending: false, isError: false, error: null as Error | null },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));
vi.mock('../api/use-packaged-products', () => ({
  usePackagedProduct: () => ({ isPending: false, isError: false, data: mocks.product.current }),
}));
vi.mock('../api/use-packaging-candidates', () => ({
  usePackagedProductStoreLabels: () => ({ isError: false, isSuccess: true, data: [] }),
}));
vi.mock('../api/use-receipt-hints', () => ({
  usePackagedProductReceiptHints: () => ({ data: mocks.hints.current }),
}));
vi.mock('../api/use-packaging-photos', () => ({
  usePackagedProductPhotos: () => ({ isError: false, data: [] }),
  useDeletePackagingPhotoMutation: () => ({ isPending: false, mutate: vi.fn() }),
  useUploadPackagingPhotosMutation: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock('../api/use-update-packaged-product-mutation', () => ({
  useDeletePackagedProductMutation: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
}));
vi.mock('../api/use-link-store-product-mutation', () => ({
  useLinkStoreProductMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock('../api/use-update-review-notes-mutation', () => ({
  useUpdateReviewNotesMutation: () => ({
    mutateAsync: mocks.updateNotes,
    ...mocks.updateState,
  }),
}));
vi.mock('./NutritionFactsTable', () => ({ NutritionFactsTable: () => null }));
vi.mock('./PackagingPhotoGallery', () => ({ PackagingPhotoGallery: () => null }));
vi.mock('./PackagingPhotoUploader', () => ({ PackagingPhotoUploader: () => null }));
vi.mock('./StoreLabelsTable', () => ({ StoreLabelsTable: () => null }));

function product(review_notes: string[]): PackagedProductRow {
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
    review_notes,
    import_source: 'manual-json',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
}

beforeEach(() => {
  mocks.updateNotes.mockReset().mockResolvedValue(undefined);
  mocks.updateState.isPending = false;
  mocks.updateState.isError = false;
  mocks.updateState.error = null;
  mocks.hints.current = [];
});

describe('PackagedProductDetail receipt hints', () => {
  it('lists the import hints without linking anything', () => {
    mocks.product.current = product([]);
    mocks.hints.current = [
      { store: 'REWE', receipt_label: 'Originals', receipt_date: '2026-09-13' },
    ];
    render(<PackagedProductDetail id="01JAAAAAAAAAAAAAAAAAAAAAAA" />);
    expect(
      screen.getByRole('heading', { name: 'Підказки з імпорту: назви в чеках' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/REWE · «Originals»/)).toBeInTheDocument();
    expect(screen.getByText(/нічого не прив’язано/)).toBeInTheDocument();
  });

  it('shows no hints block for a card without hints', () => {
    mocks.product.current = product([]);
    render(<PackagedProductDetail id="01JAAAAAAAAAAAAAAAAAAAAAAA" />);
    expect(screen.queryByText(/Підказки з імпорту/)).not.toBeInTheDocument();
  });
});

describe('PackagedProductDetail review notes', () => {
  it('shows the reasons prominently above the card facts', () => {
    mocks.product.current = product(['Штрихкод розмитий', 'Немає звороту']);
    render(<PackagedProductDetail id="01JAAAAAAAAAAAAAAAAAAAAAAA" />);
    expect(screen.getByRole('heading', { name: 'Потрібна перевірка' })).toBeInTheDocument();
    expect(screen.getByText('Штрихкод розмитий')).toBeInTheDocument();
    expect(screen.getByText('Немає звороту')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Товар' })).toBeInTheDocument();
  });

  it('writes the remaining notes for this card when one is marked as checked', async () => {
    mocks.product.current = product(['Штрихкод розмитий', 'Немає звороту']);
    render(<PackagedProductDetail id="01JAAAAAAAAAAAAAAAAAAAAAAA" />);
    fireEvent.click(screen.getByRole('button', { name: 'Перевірено: Штрихкод розмитий' }));
    await waitFor(() =>
      expect(mocks.updateNotes).toHaveBeenCalledWith({
        id: '01JAAAAAAAAAAAAAAAAAAAAAAA',
        review_notes: ['Немає звороту'],
      }),
    );
  });

  it('clears the marker when the last note is checked', async () => {
    mocks.product.current = product(['Єдина причина']);
    render(<PackagedProductDetail id="01JAAAAAAAAAAAAAAAAAAAAAAA" />);
    fireEvent.click(screen.getByRole('button', { name: 'Перевірено: Єдина причина' }));
    await waitFor(() =>
      expect(mocks.updateNotes).toHaveBeenCalledWith({
        id: '01JAAAAAAAAAAAAAAAAAAAAAAA',
        review_notes: [],
      }),
    );
  });

  it('shows no warning block for a card without notes', () => {
    mocks.product.current = product([]);
    render(<PackagedProductDetail id="01JAAAAAAAAAAAAAAAAAAAAAAA" />);
    expect(screen.queryByRole('heading', { name: 'Потрібна перевірка' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Позначити для перевірки' })).toBeInTheDocument();
  });

  it('shows the failure of a note update', () => {
    mocks.product.current = product(['Причина']);
    mocks.updateState.isError = true;
    mocks.updateState.error = new Error('RLS denied');
    render(<PackagedProductDetail id="01JAAAAAAAAAAAAAAAAAAAAAAA" />);
    expect(screen.getByText(/Не вдалося оновити примітки/)).toBeInTheDocument();
  });
});

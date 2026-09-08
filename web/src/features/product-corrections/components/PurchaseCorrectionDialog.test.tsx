import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PurchaseCorrectionDialog } from './PurchaseCorrectionDialog';

const mutate = vi.fn();
vi.mock('../api/use-purchase-correction', () => ({
  useCorrectablePurchase: () => ({
    data: {
      id: 'item',
      receipt_id: 'receipt',
      product_id: null,
      raw_product_name: 'ORIGINAL',
      product_name: 'Original',
      category: 'Інше',
      product_family_id: 'unknown',
      product_variant_id: 'old',
      receipt: { store: 'REWE', date: '2026-09-08', time: '12:30:00' },
    },
    isLoading: false,
    isError: false,
  }),
  usePurchaseCorrectionMutation: () => ({ mutate, isPending: false, isError: false }),
}));
vi.mock('@/features/categories', () => ({
  useCategories: () => ({
    data: [{ name: 'Інше' }, { name: 'Бакалія' }],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/features/products/api/use-products', () => ({
  useProductTaxonomy: () => ({
    data: {
      families: [
        { id: 'unknown', name_uk: 'Невідоме', name_de: '' },
        { id: 'chips', name_uk: 'Чипси', name_de: 'Chips' },
      ],
      variants: [
        { id: 'old', family_id: 'unknown', name_uk: 'Старий варіант', name_de: '' },
        { id: 'original', family_id: 'chips', name_uk: 'Оригінальні', name_de: '' },
      ],
    },
    isLoading: false,
    isError: false,
  }),
}));

describe('purchase classification correction', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
  });
  beforeEach(() => mutate.mockReset());

  it('corrects the item and opts into its store rule while preserving the printed evidence', async () => {
    const user = userEvent.setup();
    render(<PurchaseCorrectionDialog itemId="item" onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText('ORIGINAL')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Назва товару'));
    await user.type(screen.getByLabelText('Назва товару'), 'Pringles Original');
    await user.selectOptions(screen.getByLabelText('Категорія'), 'Бакалія');
    await user.selectOptions(screen.getByLabelText('Тип товару'), 'chips');
    expect(screen.getByLabelText('Різновид')).toHaveValue('');
    expect(screen.queryByRole('option', { name: /Старий варіант/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Різновид'), 'original');
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByText('ORIGINAL')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Зберегти виправлення' }));
    expect(mutate).toHaveBeenCalledWith(
      {
        itemId: 'item',
        receiptId: 'receipt',
        productName: 'Pringles Original',
        category: 'Бакалія',
        productFamilyId: 'chips',
        productVariantId: 'original',
        rememberRule: true,
      },
      expect.anything(),
    );
  });

  it('allows a one-purchase correction without a rule or an invented variant', async () => {
    const user = userEvent.setup();
    render(<PurchaseCorrectionDialog itemId="item" onClose={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Тип товару'), '');
    await user.click(screen.getByRole('button', { name: 'Зберегти виправлення' }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        productFamilyId: null,
        productVariantId: null,
        rememberRule: false,
      }),
      expect.anything(),
    );
  });
});

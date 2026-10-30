import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PackagedProductJsonImportDialog } from './PackagedProductJsonImportDialog';
import type { PackagedProductListRow } from '../api/use-packaged-products';
import type { PackagingCandidateRow } from '../types';
import type { PackagingSavePlan } from '../api/use-save-packaged-products-mutation';

vi.mock('../api/use-packaging-candidates', () => ({
  usePackagingCandidates: () => ({ data: [CANDIDATE], isPending: false, isError: false }),
}));
const openPdf = vi.hoisted(() => vi.fn());
vi.mock('@/shared/lib/dependencies', () => ({ openPackagingPdf: openPdf }));
const storedReceipts = vi.hoisted(() => ({ matches: [] as unknown[] }));
vi.mock('../api/use-receipt-duplicates', () => ({
  usePackagingReceiptDuplicates: () => ({ data: storedReceipts.matches }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: React.ReactNode;
    to: string;
    params: { id: string };
  }) => <a href={to.replace('$id', params.id)}>{children}</a>,
}));

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
    review_notes: [],
    attributes: {},
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
  other_store_purchases_count: 1,
};

function renderDialog(
  overrides: Partial<Parameters<typeof PackagedProductJsonImportDialog>[0]> = {},
) {
  const onImported = vi.fn<(products: PackagingSavePlan) => void>();
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
  return screen.getByLabelText<HTMLTextAreaElement>('Запит для ШІ').value;
}

function paste(json: string) {
  fireEvent.change(screen.getByLabelText('JSON'), { target: { value: json } });
  fireEvent.click(screen.getByRole('button', { name: 'Перевірити JSON і PDF' }));
}

async function confirmSave() {
  const confirm = await screen.findByLabelText(/Я перевірив сторінки/);
  fireEvent.click(confirm);
  fireEvent.click(screen.getByRole('button', { name: 'Зберегти товари та фото' }));
}

describe('PackagedProductJsonImportDialog', () => {
  it('accepts a valid single product', async () => {
    const { onImported } = renderDialog();
    paste(VALID_JSON);
    expect(onImported).not.toHaveBeenCalled();
    await confirmSave();

    await vi.waitFor(() => {
      expect(onImported).toHaveBeenCalledTimes(1);
    });
    const [products] = onImported.mock.calls[0] ?? [];
    expect(products?.[0]?.name).toBe('Pringles Original 165 г');
  });

  it('accepts an array of products', async () => {
    const { onImported } = renderDialog();
    const second = JSON.parse(VALID_JSON) as Record<string, unknown>;
    second.name = 'Pringles Paprika 165 г';
    second.barcode = '5449000000996';
    paste(JSON.stringify([JSON.parse(VALID_JSON), second]));
    await confirmSave();

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

  it('reuses an existing barcode without overwriting the card', async () => {
    const { onImported } = renderDialog({
      existing: [existingRow({ barcode: '5053990101658', name: 'Стара картка' })],
    });
    paste(VALID_JSON);
    expect(await screen.findByText(/Використати наявну картку/)).toBeInTheDocument();
    await confirmSave();
    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(onImported.mock.calls[0]?.[0][0]).toMatchObject({
      id: '01JAAAAAAAAAAAAAAAAAAAAAAA',
      row: null,
    });
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
    await confirmSave();

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

  it('tells the AI about the optional review_notes field', () => {
    renderDialog();
    const prompt = promptText();
    expect(prompt).toContain('"review_notes": []');
    expect(prompt).toContain('Правила перевірки (review_notes)');
    expect(prompt).toContain('до 10 коротких рядків');
  });

  it('tells the AI about the optional attributes field', () => {
    renderDialog();
    const prompt = promptText();
    expect(prompt).toContain('"attributes": {');
    expect(prompt).toContain('Правила розділу «Інше» (attributes)');
  });

  it('shows review notes before saving and keeps them in the save plan', async () => {
    const { onImported } = renderDialog();
    const payload = {
      ...(JSON.parse(VALID_JSON) as object),
      review_notes: ['  Штрихкод розмитий: перевір останні цифри ', 'Немає звороту'],
    };
    paste(JSON.stringify(payload));

    expect(await screen.findByText('Штрихкод розмитий: перевір останні цифри')).toBeInTheDocument();
    expect(screen.getByText('Немає звороту')).toBeInTheDocument();
    expect(screen.getByText(/Примітки збережуться на новій картці/)).toBeInTheDocument();

    await confirmSave();
    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(onImported.mock.calls[0]?.[0][0]?.review_notes).toEqual([
      'Штрихкод розмитий: перевір останні цифри',
      'Немає звороту',
    ]);
    expect(onImported.mock.calls[0]?.[0][0]?.row?.review_notes).toEqual([
      'Штрихкод розмитий: перевір останні цифри',
      'Немає звороту',
    ]);
  });

  it('explains that notes are merged into a reused card', async () => {
    renderDialog({
      existing: [existingRow({ barcode: '5053990101658', review_notes: ['Стара примітка'] })],
    });
    paste(JSON.stringify({ ...(JSON.parse(VALID_JSON) as object), review_notes: ['Нова'] }));

    expect(await screen.findByText(/Нові примітки додадуться до наявних/)).toBeInTheDocument();
  });

  it('shows no review block when the product has no notes', async () => {
    renderDialog();
    paste(JSON.stringify({ ...(JSON.parse(VALID_JSON) as object), review_notes: null }));

    await screen.findByLabelText(/Я перевірив сторінки/);
    expect(screen.queryByText('Потрібна перевірка')).not.toBeInTheDocument();
  });

  it('rejects more than 10 notes before any PDF work', async () => {
    const { onImported } = renderDialog();
    const review_notes = Array.from({ length: 11 }, (_, i) => `Причина ${String(i)}`);
    paste(JSON.stringify({ ...(JSON.parse(VALID_JSON) as object), review_notes }));

    expect(await screen.findByRole('alert')).toHaveTextContent('review_notes');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('shows the proposed «Інше» pairs before saving and keeps them in the save plan', async () => {
    const { onImported } = renderDialog();
    paste(
      JSON.stringify({
        ...(JSON.parse(VALID_JSON) as object),
        attributes: { ' Сорт ': ' Jonagold ', Калібр: '65–70 мм' },
      }),
    );

    expect(await screen.findByText('Jonagold')).toBeInTheDocument();
    expect(screen.getByText('65–70 мм')).toBeInTheDocument();
    expect(screen.getByText('Калібр')).toBeInTheDocument();
    expect(screen.getByText(/Пункти збережуться на новій картці/)).toBeInTheDocument();

    await confirmSave();
    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(onImported.mock.calls[0]?.[0][0]?.attributes).toEqual({
      Сорт: 'Jonagold',
      Калібр: '65–70 мм',
    });
    expect(onImported.mock.calls[0]?.[0][0]?.row?.attributes).toEqual({
      Сорт: 'Jonagold',
      Калібр: '65–70 мм',
    });
  });

  it('explains that only new keys are added to a reused card', async () => {
    renderDialog({
      existing: [existingRow({ barcode: '5053990101658', attributes: { Сорт: 'Gala' } })],
    });
    paste(
      JSON.stringify({ ...(JSON.parse(VALID_JSON) as object), attributes: { Сорт: 'Jonagold' } }),
    );

    expect(await screen.findByText(/Значення, які там уже є, не змінюються/)).toBeInTheDocument();
  });

  it('shows no «Інше» block when the product has no attributes', async () => {
    renderDialog();
    paste(JSON.stringify({ ...(JSON.parse(VALID_JSON) as object), attributes: null }));

    await screen.findByLabelText(/Я перевірив сторінки/);
    expect(screen.queryByText('Інше')).not.toBeInTheDocument();
  });

  it('rejects more than 15 pairs before any PDF work', async () => {
    const { onImported } = renderDialog();
    const attributes = Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [`Ключ ${String(i)}`, 'значення']),
    );
    paste(JSON.stringify({ ...(JSON.parse(VALID_JSON) as object), attributes }));

    expect(await screen.findByRole('alert')).toHaveTextContent('attributes');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('reports unreadable JSON without throwing', async () => {
    const { onImported } = renderDialog();
    paste('{ not json');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });

  it('does not attach the selected receipt label to the first product in an array', async () => {
    const { onImported } = renderDialog({ candidate: CANDIDATE });
    const second = {
      ...(JSON.parse(VALID_JSON) as object),
      name: 'Milk',
      barcode: '5449000000996',
    };
    paste(JSON.stringify([second, JSON.parse(VALID_JSON)]));
    await confirmSave();
    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(onImported.mock.calls[0]?.[0].map((entry) => entry.links)).toEqual([[], []]);
  });

  it('keeps a failed save open and retries the same plan', async () => {
    const onImported = vi
      .fn()
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValue(undefined);
    renderDialog({ onImported });
    paste(VALID_JSON);
    await confirmSave();
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    fireEvent.click(screen.getByRole('button', { name: 'Повторити збереження' }));
    await vi.waitFor(() => expect(onImported).toHaveBeenCalledTimes(2));
    expect(onImported.mock.calls[0]?.[0]).toBe(onImported.mock.calls[1]?.[0]);
  });

  it('links the chosen second product without linking the first product', async () => {
    const { onImported } = renderDialog({ candidate: CANDIDATE });
    paste(
      JSON.stringify([{ name: 'Milk', category: 'Молочка' }, JSON.parse(VALID_JSON) as unknown]),
    );
    await screen.findByLabelText(/Я перевірив сторінки/);
    fireEvent.click(screen.getAllByRole('checkbox')[1]!);
    await confirmSave();
    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(onImported.mock.calls[0]?.[0].map((entry) => entry.links)).toEqual([
      [],
      [CANDIDATE.product_id],
    ]);
  });

  it('blocks the same store label selected for two different products', async () => {
    const { onImported } = renderDialog({ candidate: CANDIDATE });
    paste(
      JSON.stringify([{ name: 'Milk', category: 'Молочка' }, JSON.parse(VALID_JSON) as unknown]),
    );
    await screen.findByLabelText(/Я перевірив сторінки/);
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    fireEvent.click(screen.getAllByRole('checkbox')[1]!);
    await confirmSave();
    expect(await screen.findByRole('alert')).toHaveTextContent('двох товарів');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('requires the PDF when the JSON references its pages', async () => {
    const { onImported } = renderDialog();
    paste(
      JSON.stringify({
        products: [
          { ...(JSON.parse(VALID_JSON) as object), source_pages: [{ page: 2, kind: 'front' }] },
        ],
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Додай той самий PDF');
    expect(onImported).not.toHaveBeenCalled();
  });

  it('previews receipt and packaging pages but saves only packaging JPEGs', async () => {
    const front = new Blob(['front'], { type: 'image/jpeg' });
    const receipt = new Blob(['receipt'], { type: 'image/jpeg' });
    const close = vi.fn().mockResolvedValue(undefined);
    openPdf.mockResolvedValue({
      pageCount: 2,
      fingerprint: 'abc',
      renderPages: vi.fn().mockResolvedValue(
        new Map([
          [1, receipt],
          [2, front],
        ]),
      ),
      close,
    });
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:preview'),
        revokeObjectURL: vi.fn(),
      }),
    );
    const { onImported } = renderDialog();
    fireEvent.change(screen.getByLabelText(/PDF із фотографіями/), {
      target: { files: [new File(['pdf'], 'shopping.pdf', { type: 'application/pdf' })] },
    });
    paste(
      JSON.stringify({
        receipt_pages: [1],
        products: [
          { ...(JSON.parse(VALID_JSON) as object), source_pages: [{ page: 2, kind: 'front' }] },
        ],
      }),
    );
    expect(await screen.findByAltText('Лицевий бік · сторінка 2')).toBeInTheDocument();
    expect(screen.getByAltText('Чек · сторінка 1')).toBeInTheDocument();
    await confirmSave();
    await vi.waitFor(() => expect(onImported).toHaveBeenCalled());
    const plan = onImported.mock.calls[0]?.[0];
    expect(plan?.[0]?.photos).toHaveLength(1);
    expect(plan?.[0]?.photos[0]?.blob).toBe(front);
    expect(close).toHaveBeenCalled();
  });
});

describe('receipt on the PDF', () => {
  const RECEIPT_LINE = 'Чек зі сторінки 1 буде додано через імпорт чеків';
  const PAYERS = ['anna@example.com', 'bob@example.com'];

  const receiptPdfBlob = () => new Blob(['%PDF-receipt'], { type: 'application/pdf' });

  function mockPdf(extractPages = vi.fn().mockResolvedValue(receiptPdfBlob()), pageCount = 2) {
    openPdf.mockResolvedValue({
      pageCount,
      fingerprint: 'abc',
      renderPages: vi
        .fn()
        .mockResolvedValue(
          new Map(
            Array.from({ length: pageCount }, (_, i): [number, Blob] => [
              i + 1,
              new Blob([`page ${String(i + 1)}`], { type: 'image/jpeg' }),
            ]),
          ),
        ),
      extractPages,
      close: vi.fn().mockResolvedValue(undefined),
    });
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:preview'),
        revokeObjectURL: vi.fn(),
      }),
    );
    return extractPages;
  }

  async function pasteWithPdf(envelope: Record<string, unknown> = {}) {
    fireEvent.change(screen.getByLabelText(/PDF із фотографіями/), {
      target: { files: [new File(['pdf'], 'shopping.pdf', { type: 'application/pdf' })] },
    });
    paste(
      JSON.stringify({
        receipt_pages: [1],
        ...envelope,
        products: [
          { ...(JSON.parse(VALID_JSON) as object), source_pages: [{ page: 2, kind: 'front' }] },
        ],
      }),
    );
    await screen.findByAltText('Чек · сторінка 1');
  }

  function renderWithReceipt(overrides: Parameters<typeof renderDialog>[0] = {}) {
    const onImported = vi.fn().mockResolvedValue([{ id: 'card-1', name: 'Pringles' }]);
    const onEnqueueReceipt = vi.fn().mockResolvedValue('BATCH-1');
    const onFinished = vi.fn();
    const onClose = vi.fn();
    renderDialog({
      onImported,
      onEnqueueReceipt,
      onFinished,
      onClose,
      payerOptions: PAYERS,
      defaultPayer: 'bob@example.com',
      ...overrides,
    });
    return { onImported, onEnqueueReceipt, onFinished, onClose };
  }

  beforeEach(() => {
    openPdf.mockReset();
    storedReceipts.matches = [];
  });

  it('offers to add the receipt, on by default, with the signed-in user as payer', async () => {
    mockPdf();
    renderWithReceipt();
    await pasteWithPdf();

    expect(screen.getByLabelText(RECEIPT_LINE)).toBeChecked();
    expect(screen.getByLabelText('Хто оплатив чек')).toHaveValue('bob@example.com');
  });

  it('cuts only the receipt pages out of the PDF', async () => {
    const extractPages = mockPdf();
    renderWithReceipt();
    await pasteWithPdf();

    expect(extractPages).toHaveBeenCalledWith([1]);
  });

  it('saves the cards first, then queues the receipt PDF for the chosen payer', async () => {
    mockPdf();
    const { onImported, onEnqueueReceipt, onFinished, onClose } = renderWithReceipt();
    await pasteWithPdf();
    fireEvent.change(screen.getByLabelText('Хто оплатив чек'), {
      target: { value: 'anna@example.com' },
    });
    await confirmSave();

    expect(await screen.findByText(/Чек додано до імпорту чеків/)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onEnqueueReceipt).toHaveBeenCalledTimes(1);
    expect(onImported.mock.invocationCallOrder[0]).toBeLessThan(
      onEnqueueReceipt.mock.invocationCallOrder[0]!,
    );
    const request = onEnqueueReceipt.mock.calls[0]?.[0] as { file: File; paidBy: string };
    expect(request.paidBy).toBe('anna@example.com');
    expect(request.file.name).toBe('shopping — чек, стор. 1.pdf');
    expect(request.file.type).toBe('application/pdf');
    expect(await request.file.text()).toBe('%PDF-receipt');
    expect(screen.getByRole('link', { name: 'Відкрити імпорт чека' })).toHaveAttribute(
      'href',
      '/imports/BATCH-1',
    );

    // The dialog stays on the result until the person is done with it.
    expect(onFinished).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onFinished).toHaveBeenCalledWith([{ id: 'card-1', name: 'Pringles' }]);
    expect(onClose).toHaveBeenCalled();
  });

  it('adds no receipt when the line is switched off', async () => {
    mockPdf();
    const { onImported, onEnqueueReceipt, onFinished } = renderWithReceipt();
    await pasteWithPdf();
    fireEvent.click(screen.getByLabelText(RECEIPT_LINE));
    expect(screen.getByText(/Чек не буде додано/)).toBeInTheDocument();
    await confirmSave();

    await vi.waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onEnqueueReceipt).not.toHaveBeenCalled();
  });

  it('keeps the saved cards and says so when the receipt cannot be queued, then retries only the receipt', async () => {
    mockPdf();
    const { onImported, onEnqueueReceipt, onFinished } = renderWithReceipt();
    onEnqueueReceipt.mockRejectedValueOnce(new Error('Сховище недоступне'));
    await pasteWithPdf();
    await confirmSave();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Картки збережено, але чек не додано до імпорту');
    expect(alert).toHaveTextContent('Сховище недоступне');
    expect(onFinished).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Повторити додавання чека' }));

    expect(await screen.findByText(/Чек додано до імпорту чеків/)).toBeInTheDocument();
    expect(onEnqueueReceipt).toHaveBeenCalledTimes(2);
    expect(onEnqueueReceipt.mock.calls[1]?.[0]).toBe(onEnqueueReceipt.mock.calls[0]?.[0]);
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('closes without the receipt after a failure and still reports the saved cards', async () => {
    mockPdf();
    const { onEnqueueReceipt, onFinished, onClose } = renderWithReceipt();
    onEnqueueReceipt.mockRejectedValue(new Error('Немає мережі'));
    await pasteWithPdf();
    await confirmSave();
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Закрити без чека' }));

    expect(onFinished).toHaveBeenCalledWith([{ id: 'card-1', name: 'Pringles' }]);
    expect(onClose).toHaveBeenCalled();
  });

  it('still saves the cards when the receipt pages cannot be cut out of the PDF', async () => {
    mockPdf(vi.fn().mockRejectedValue(new Error('Файл зашифрований')));
    const { onImported, onEnqueueReceipt, onFinished } = renderWithReceipt();
    await pasteWithPdf();

    expect(screen.getByRole('alert')).toHaveTextContent('не вдалося підготувати для імпорту');
    expect(screen.getByRole('alert')).toHaveTextContent('Файл зашифрований.');
    expect(screen.queryByLabelText(RECEIPT_LINE)).not.toBeInTheDocument();
    await confirmSave();

    await vi.waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onEnqueueReceipt).not.toHaveBeenCalled();
  });

  it('warns about a stored receipt with the same date, store and total, but does not block', async () => {
    mockPdf();
    storedReceipts.matches = [
      { id: 'r1', store: 'REWE', date: '2026-09-13', total_orig: 23.45, currency: 'EUR' },
    ];
    const { onImported, onEnqueueReceipt } = renderWithReceipt();
    await pasteWithPdf({ receipt: { store: 'REWE', date: '2026-09-13', total: 23.45 } });

    expect(screen.getByText('Схоже, такий чек уже є в базі:')).toBeInTheDocument();
    expect(screen.getByText(/За даними JSON: REWE/)).toBeInTheDocument();
    await confirmSave();

    expect(await screen.findByText(/Чек додано до імпорту чеків/)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(onEnqueueReceipt).toHaveBeenCalledTimes(1);
  });

  it('shows no duplicate warning when nothing matches', async () => {
    mockPdf();
    renderWithReceipt();
    await pasteWithPdf({ receipt: { store: 'REWE', date: '2026-09-13', total: 23.45 } });

    expect(screen.queryByText(/Схоже, такий чек уже є/)).not.toBeInTheDocument();
  });

  it('refuses to start without a payer instead of failing after the cards are saved', async () => {
    mockPdf();
    const { onImported, onEnqueueReceipt } = renderWithReceipt({
      payerOptions: [],
      defaultPayer: '',
    });
    await pasteWithPdf();
    await confirmSave();

    expect(await screen.findByRole('alert')).toHaveTextContent('Вибери, хто оплатив чек');
    expect(onImported).not.toHaveBeenCalled();
    expect(onEnqueueReceipt).not.toHaveBeenCalled();
  });

  it('sends several receipt pages as one document and says so', async () => {
    const extractPages = mockPdf(undefined, 3);
    const { onEnqueueReceipt } = renderWithReceipt();
    fireEvent.change(screen.getByLabelText(/PDF із фотографіями/), {
      target: { files: [new File(['pdf'], 'shopping.pdf', { type: 'application/pdf' })] },
    });
    paste(
      JSON.stringify({
        receipt_pages: [1, 2],
        products: [
          { ...(JSON.parse(VALID_JSON) as object), source_pages: [{ page: 3, kind: 'front' }] },
        ],
      }),
    );

    expect(
      await screen.findByLabelText(/^Чек зі сторінок 1, 2 буде додано через імпорт чеків/),
    ).toBeChecked();
    expect(screen.getByText(/підуть одним документом/)).toBeInTheDocument();
    expect(extractPages).toHaveBeenCalledWith([1, 2]);
    await confirmSave();

    await vi.waitFor(() => expect(onEnqueueReceipt).toHaveBeenCalledTimes(1));
    const request = onEnqueueReceipt.mock.calls[0]?.[0] as { file: File };
    expect(request.file.name).toBe('shopping — чек, стор. 1, 2.pdf');
  });

  it('does not mention a receipt when the JSON has no receipt pages', async () => {
    mockPdf();
    renderWithReceipt();
    fireEvent.change(screen.getByLabelText(/PDF із фотографіями/), {
      target: { files: [new File(['pdf'], 'shopping.pdf', { type: 'application/pdf' })] },
    });
    paste(
      JSON.stringify({
        products: [
          { ...(JSON.parse(VALID_JSON) as object), source_pages: [{ page: 2, kind: 'front' }] },
        ],
      }),
    );
    await screen.findByAltText('Лицевий бік · сторінка 2');

    expect(screen.queryByText('Чек із PDF')).not.toBeInTheDocument();
  });
});

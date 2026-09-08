import {
  groupCategoryStats,
  selectDetailItems,
  summarizeCategoryDetails,
  type StatsDetailItem,
} from './category-details';

function item(overrides: Partial<StatsDetailItem> = {}): StatsDetailItem {
  return {
    id: '1',
    receipt_id: 'r1',
    category: 'Овочі/фрукти',
    product_name: 'Помідори',
    total_eur: 10,
    product_family_id: 'tomato',
    family: { name_uk: 'Помідори' },
    receipt: { date: '2026-08-01', store: 'Lidl' },
    ...overrides,
  };
}

describe('category detail totals', () => {
  it('drills into a family across names and stores, then an optional variant without losing refunds', () => {
    const purchases = [
      item({
        id: '1',
        product_name: 'Філе',
        product_family_id: 'chicken',
        product_variant_id: 'plain',
        variant: { name_uk: 'Немариноване філе' },
        total_eur: 5,
      }),
      item({
        id: '2',
        product_name: 'Hähnchenfilet',
        product_family_id: 'chicken',
        product_variant_id: 'plain',
        total_eur: -1,
        receipt: { date: '2026-08-02', time: '12:30:00', store: 'REWE' },
      }),
      item({
        id: '3',
        product_name: 'Ніжки',
        product_family_id: 'chicken',
        product_variant_id: null,
        total_eur: 3,
      }),
      item({ id: '4', product_name: 'Лохина', total_eur: 2 }),
    ];
    const family = summarizeCategoryDetails(selectDetailItems(purchases, { family: 'chicken' }));
    expect(family.total_eur).toBe(7);
    expect(family.items.map((row) => row.id)).toEqual(['2', '3', '1']);
    expect(family.variants.map((row) => row.total_eur)).toEqual([4, 3]);
    const variant = summarizeCategoryDetails(
      selectDetailItems(purchases, { family: 'chicken', variant: 'plain' }),
    );
    expect(variant.total_eur).toBe(4);
    expect(variant.items).toHaveLength(2);
    expect(
      selectDetailItems(purchases, { family: 'chicken', variant: 'unspecified' }).map(
        (row) => row.id,
      ),
    ).toEqual(['3']);
    expect(selectDetailItems(purchases, { family: 'chicken', product: 'Лохина' })).toEqual([]);
  });

  it('opens every unclassified purchase including unlinked and negative rows', () => {
    const purchases = [
      item(),
      item({ id: 'unknown', product_family_id: null, family: null, total_eur: -2 }),
    ];
    expect(selectDetailItems(purchases, { family: 'unclassified' }).map((row) => row.id)).toEqual([
      'unknown',
    ]);
  });
  it('combines a family across stores and retains unclassified purchases in every total', () => {
    const result = summarizeCategoryDetails([
      item(),
      item({
        id: '2',
        receipt_id: 'r2',
        total_eur: 20,
        receipt: { date: '2026-09-01', store: 'REWE' },
      }),
      item({ id: '3', total_eur: 5, product_family_id: null, family: null }),
    ]);
    expect(result.total_eur).toBe(35);
    expect(result.receipts_count).toBe(2);
    expect(result.items_count).toBe(3);
    expect(result.families).toEqual([
      { key: 'tomato', name: 'Помідори', total_eur: 30 },
      { key: 'unclassified', name: 'Без визначеного сімейства', total_eur: 5 },
    ]);
    expect(result.products).toEqual([{ key: 'Помідори', name: 'Помідори', total_eur: 35 }]);
    expect(result.stores.map((row) => row.total_eur)).toEqual([20, 15]);
    expect(
      result.months.map(({ month, total_eur, receipts_count }) => ({
        month,
        total_eur,
        receipts_count,
      })),
    ).toEqual([
      { month: '2026-09', total_eur: 20, receipts_count: 1 },
      { month: '2026-08', total_eur: 15, receipts_count: 1 },
    ]);
  });

  it('uses family identity instead of translated labels and keeps refunds and cents', () => {
    const result = summarizeCategoryDetails([
      item({ total_eur: 0.1 }),
      item({ total_eur: 0.2 }),
      item({ total_eur: -0.1 }),
      item({ product_family_id: 'other', total_eur: 0.4 }),
    ]);
    expect(result.total_eur).toBe(0.6);
    expect(result.families).toHaveLength(2);
    expect(result.families.find((row) => row.key === 'tomato')?.total_eur).toBe(0.2);
    expect(result.categories[0]?.total_eur).toBe(0.6);
  });

  it('returns empty breakdowns for no purchases', () => {
    expect(summarizeCategoryDetails([])).toMatchObject({
      total_eur: 0,
      items_count: 0,
      receipts_count: 0,
      stores: [],
      products: [],
      categories: [],
      families: [],
      months: [],
    });
  });

  it('groups purchases by their historical product name independently of the family', () => {
    const result = summarizeCategoryDetails([
      item({ product_name: 'Лохина', product_family_id: null, family: null, total_eur: 3.5 }),
      item({ id: '2', product_name: 'Лохина', total_eur: 1.5 }),
      item({ id: '3', product_name: 'Персики', total_eur: 4 }),
    ]);

    expect(result.products).toEqual([
      { key: 'Лохина', name: 'Лохина', total_eur: 5 },
      { key: 'Персики', name: 'Персики', total_eur: 4 },
    ]);
  });

  it('groups only the supplied filtered category totals', () => {
    expect(
      groupCategoryStats(
        [
          { category: 'Овочі/фрукти', total_eur: 20, items_count: 2 },
          { category: 'Молочка', total_eur: 10, items_count: 1 },
          { category: 'Аптека', total_eur: 5, items_count: 1 },
        ],
        [
          { name: 'Овочі/фрукти', group_name: 'Продукти' },
          { name: 'Молочка', group_name: 'Продукти' },
          { name: 'Аптека', group_name: 'Побут' },
        ],
      ),
    ).toEqual([
      { key: 'Продукти', name: 'Продукти', total_eur: 30 },
      { key: 'Побут', name: 'Побут', total_eur: 5 },
    ]);
  });
});

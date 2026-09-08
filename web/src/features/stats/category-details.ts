import { roundMoney } from '@finance-tracker/domain';
import type { StatsByCategoryRow, StatsByMonthRow } from './api/stats.types';

export type StatsSelection = {
  group?: string;
  category?: string;
  family?: string;
  variant?: string;
  product?: string;
};

export type StatsDetailItem = {
  id: string;
  receipt_id: string;
  category: string;
  product_name: string;
  total_eur: number;
  product_family_id: string | null;
  family: { name_uk: string } | null;
  product_variant_id?: string | null;
  variant?: { name_uk: string } | null;
  qty?: number;
  unit_price_orig?: number;
  discount_orig?: number;
  total_orig?: number;
  receipt: {
    date: string;
    store: string;
    time?: string | null;
    currency?: string;
    photo_path?: string | null;
    photo_url?: string | null;
  };
};

export function selectDetailItems(items: StatsDetailItem[], selection: StatsSelection) {
  return items.filter(
    (item) =>
      (selection.family === undefined ||
        (item.product_family_id ?? 'unclassified') === selection.family) &&
      (selection.variant === undefined ||
        (item.product_variant_id ?? 'unspecified') === selection.variant) &&
      (selection.product === undefined || item.product_name === selection.product),
  );
}

export type StatsBreakdownRow = { key: string; name: string; total_eur: number };

function addAmount(
  rows: Map<string, StatsBreakdownRow>,
  key: string,
  name: string,
  amount: number,
) {
  const previous = rows.get(key);
  rows.set(key, { key, name, total_eur: roundMoney((previous?.total_eur ?? 0) + amount) });
}

function sorted(rows: Map<string, StatsBreakdownRow>) {
  return [...rows.values()].sort(
    (a, b) => b.total_eur - a.total_eur || a.name.localeCompare(b.name, 'uk'),
  );
}

export function groupCategoryStats(
  rows: StatsByCategoryRow[],
  categories: { name: string; group_name: string }[],
) {
  const groups = new Map<string, StatsBreakdownRow>();
  const names = new Map(categories.map((category) => [category.name, category.group_name]));
  for (const row of rows) {
    const group = names.get(row.category);
    if (group !== undefined) addAmount(groups, group, group, row.total_eur);
  }
  return sorted(groups);
}

export function summarizeCategoryDetails(items: StatsDetailItem[]) {
  const stores = new Map<string, StatsBreakdownRow>();
  const products = new Map<string, StatsBreakdownRow>();
  const families = new Map<string, StatsBreakdownRow>();
  const variants = new Map<string, StatsBreakdownRow>();
  const categories = new Map<string, StatsBreakdownRow>();
  const months = new Map<string, StatsByMonthRow & { receipts: Set<string> }>();
  const receipts = new Set<string>();
  let total_eur = 0;
  for (const item of items) {
    total_eur = roundMoney(total_eur + item.total_eur);
    receipts.add(item.receipt_id);
    addAmount(stores, item.receipt.store, item.receipt.store, item.total_eur);
    addAmount(products, item.product_name, item.product_name, item.total_eur);
    addAmount(categories, item.category, item.category, item.total_eur);
    addAmount(
      variants,
      item.product_variant_id ?? 'unspecified',
      item.variant?.name_uk ?? 'Без уточнення варіанта',
      item.total_eur,
    );
    addAmount(
      families,
      item.product_family_id ?? 'unclassified',
      item.family?.name_uk ?? 'Без визначеного сімейства',
      item.total_eur,
    );
    const month = item.receipt.date.slice(0, 7);
    const row = months.get(month) ?? {
      month,
      total_eur: 0,
      receipts_count: 0,
      receipts: new Set<string>(),
    };
    row.total_eur = roundMoney(row.total_eur + item.total_eur);
    row.receipts.add(item.receipt_id);
    row.receipts_count = row.receipts.size;
    months.set(month, row);
  }
  return {
    total_eur,
    items_count: items.length,
    receipts_count: receipts.size,
    stores: sorted(stores),
    products: sorted(products),
    families: sorted(families),
    variants: sorted(variants),
    items: [...items].sort(
      (a, b) =>
        b.receipt.date.localeCompare(a.receipt.date) ||
        (b.receipt.time ?? '').localeCompare(a.receipt.time ?? '') ||
        b.id.localeCompare(a.id),
    ),
    categories: sorted(categories),
    months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)),
  };
}

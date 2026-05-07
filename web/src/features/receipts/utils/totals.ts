// Pure computations over form-state items. Shared by ItemRow display and
// SummaryFooter. Domain.makeItem applies the same formula at write-time.

import { roundMoney } from '@finance-tracker/domain';
import type { ItemFormValues } from '../schemas/manual-form';

export function computeRowTotal(item: Partial<ItemFormValues> | undefined): number {
  if (!item) return 0;
  const qty = Number(item.qty) || 0;
  const price = Number(item.unit_price_orig) || 0;
  const discount = Number(item.discount_orig) || 0;
  return roundMoney(qty * (price - discount));
}

export function computeGrandTotal(items: Partial<ItemFormValues>[]): number {
  return roundMoney(items.reduce((acc, it) => acc + computeRowTotal(it), 0));
}

export type CategoryBreakdownRow = { category: string; total: number };

export function computeCategoryBreakdown(items: Partial<ItemFormValues>[]): CategoryBreakdownRow[] {
  const map = new Map<string, number>();
  for (const it of items) {
    const cat = (it.category ?? '').trim();
    if (!cat) continue;
    const prev = map.get(cat) ?? 0;
    map.set(cat, prev + computeRowTotal(it));
  }
  return Array.from(map.entries())
    .map(([category, total]) => ({ category, total: roundMoney(total) }))
    .sort((a, b) => a.category.localeCompare(b.category, 'uk'));
}

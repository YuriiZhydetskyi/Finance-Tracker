import type { SkippedPackagingProductRow } from '../types';

// Mirrors the reasons written by public.apply_packaging_exclusion_rule (ADR-0034).
const REASON_LABELS: Record<string, string> = {
  weighed: 'вагове',
  service: 'послуга, паливо',
  non_food: 'не їжа',
  bag: 'пакет',
  loose_produce: 'розсипне',
};

/** NULL means the owner pressed «Без упаковки» by hand. */
export function skipReasonLabel(reason: string | null): string {
  if (reason === null) return 'позначено вручну';
  return REASON_LABELS[reason] ?? reason;
}

export function filterSkippedProducts<T extends SkippedPackagingProductRow>(
  rows: T[],
  query: string,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    [row.name, row.brand, row.store, row.category, row.store_product_code].some((field) =>
      field?.toLowerCase().includes(needle),
    ),
  );
}

export type SkipReasonCount = { reason: string | null; label: string; count: number };

export function countBySkipReason(rows: SkippedPackagingProductRow[]): SkipReasonCount[] {
  const counts = new Map<string | null, number>();
  for (const row of rows) {
    const reason = row.packaging_not_applicable_reason;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts]
    .map(([reason, count]) => ({ reason, label: skipReasonLabel(reason), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'uk'));
}

// detectPairs — collapse Rabatt-style cancellation/discount pairs emitted by
// the AI parser into a UI-ready shape. See ADR-0012 + ADR-0014.
//
// Conservative on purpose: only matches groups of exactly 2 items with the
// same normalized product_name. 3-or-more occurrences (two purchases plus a
// partial refund, etc.) are left alone for the user to handle manually.
//
// Originally a port of legacy/apps-script/src/ui/shared/pairDetector.html.

import type { ParsedItem } from './schemas';

export type PairMarker = { kind: 'cancelled' } | { kind: 'discount-merged' };

export type DetectedItem = ParsedItem & {
  pair_marker?: PairMarker;
};

export type PairDetectionResult = {
  items: DetectedItem[];
};

type Disposition =
  | { kind: 'keep' }
  | { kind: 'replace-cancelled' }
  | { kind: 'merged-discount'; discount_orig: number }
  | { kind: 'skip-merged' };

function normalize(name: string | undefined | null): string {
  return String(name ?? '')
    .trim()
    .toLowerCase();
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function detectPairs(parsedItems: ParsedItem[] | null | undefined): PairDetectionResult {
  if (!Array.isArray(parsedItems)) return { items: [] };

  const groups = new Map<string, number[]>();
  parsedItems.forEach((it, idx) => {
    const key = normalize(it.product_name);
    if (!key) return;
    const arr = groups.get(key);
    if (arr) arr.push(idx);
    else groups.set(key, [idx]);
  });

  const disposition: Disposition[] = parsedItems.map(() => ({ kind: 'keep' }));

  groups.forEach((indices) => {
    if (indices.length !== 2) return;
    const [firstIdx, secondIdx] = indices as [number, number];
    const first = parsedItems[firstIdx];
    const second = parsedItems[secondIdx];
    if (!first || !second) return;

    const firstTotal = first.qty * first.unit_price_orig;
    const secondTotal = second.qty * second.unit_price_orig;
    const hasOpposite = (firstTotal > 0 && secondTotal < 0) || (firstTotal < 0 && secondTotal > 0);
    if (!hasOpposite) return;

    const isFirstPositive = firstTotal > 0;
    const pos = isFirstPositive ? first : second;
    const posIdx = isFirstPositive ? firstIdx : secondIdx;
    const neg = isFirstPositive ? second : first;
    const negIdx = isFirstPositive ? secondIdx : firstIdx;

    // qty mismatch → ambiguous (e.g. +2 × X and -1 × X = partial refund); skip.
    if (Math.abs(pos.qty - neg.qty) > 0.001) return;

    // Round to 2dp before comparing so float drift (2.99 - 2.98 ≠ 0.01 in IEEE 754)
    // doesn't push a true cancellation off the equality branch.
    const posTotalR = roundCents(pos.qty * pos.unit_price_orig);
    const negTotalAbsR = roundCents(Math.abs(neg.qty * neg.unit_price_orig));

    if (posTotalR === negTotalAbsR) {
      disposition[posIdx] = { kind: 'replace-cancelled' };
      disposition[negIdx] = { kind: 'skip-merged' };
    } else if (negTotalAbsR < posTotalR) {
      disposition[posIdx] = {
        kind: 'merged-discount',
        discount_orig: Math.abs(neg.unit_price_orig),
      };
      disposition[negIdx] = { kind: 'skip-merged' };
    }
    // negTotalAbsR > posTotalR → refund larger than purchase; leave both.
  });

  const items: DetectedItem[] = [];
  parsedItems.forEach((it, idx) => {
    const d = disposition[idx];
    if (!d) return;
    if (d.kind === 'keep') {
      items.push(it);
    } else if (d.kind === 'replace-cancelled') {
      items.push({
        ...it,
        unit_price_orig: 0,
        discount_orig: 0,
        pair_marker: { kind: 'cancelled' },
      });
    } else if (d.kind === 'merged-discount') {
      items.push({
        ...it,
        discount_orig: d.discount_orig,
        pair_marker: { kind: 'discount-merged' },
      });
    }
  });

  return { items };
}
